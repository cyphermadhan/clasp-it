// Side panel — Clasp It for Claude Code

const SERVER_URL = "https://claspit.dev";

const PRO_TOGGLE_IDS = [
  "sp-toggle-screenshot",
  "sp-toggle-console",
  "sp-toggle-network",
  "sp-toggle-react",
  "sp-toggle-parent",
];

const ALL_TOGGLE_IDS = ["sp-toggle-dom", "sp-toggle-styles", ...PRO_TOGGLE_IDS];

// ── App state ────────────────────────────────────────────────────────────────

const app = {
  screen: "loading",
  apiKey: null,
  email: null,
  plan: "free",
  deviceId: null,
  pollTimer: null,
  statusPollTimer: null,
  currentElement: null,
  history: [],
  toggleListenersAdded: false,
};

// ── Storage ──────────────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}
function storageSet(obj) {
  return new Promise(r => chrome.storage.local.set(obj, r));
}
function storageRemove(keys) {
  return new Promise(r => chrome.storage.local.remove(keys, r));
}

// ── Screen routing ───────────────────────────────────────────────────────────

function showScreen(name) {
  app.screen = name;

  const header = document.getElementById("sp-header");
  const withHeader = ["main", "picking", "picked", "settings"];
  header.style.display = withHeader.includes(name) ? "flex" : "none";

  document.querySelectorAll(".sp-screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add("active");

  if (name === "auth") {
    const btn = document.getElementById("sp-signup-btn");
    if (btn) { btn.disabled = false; btn.textContent = "Get free API key"; }
  }
  if (withHeader.includes(name)) renderHeader();
  if (name === "main") { renderHistory(); updatePickButton(); }
  if (name === "settings") renderSettings();
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const stored = await storageGet(["bp_api_key", "clasp_email", "clasp_plan", "clasp_history", "clasp_device_id", "clasp_limit_date"]);
  if (stored.bp_api_key) {
    app.apiKey     = stored.bp_api_key;
    app.email      = stored.clasp_email  || null;
    app.plan       = stored.clasp_plan   || "free";
    app.history    = stored.clasp_history || [];
    app.limitDate  = stored.clasp_limit_date || null;
    applyPlanGating();
    initToggleListeners();
    await loadToggleValues();
    showScreen("main");
    startStatusPolling();
    fetchAuthInfo(); // refresh in background
    renderOnboarding();
  } else if (stored.clasp_device_id) {
    // Resume verifying state after panel reload
    app.deviceId = stored.clasp_device_id;
    app.email = stored.clasp_email || null;
    if (app.email) document.getElementById("sp-verify-email").textContent = app.email;
    showScreen("verifying");
    startDevicePoll();
  } else {
    showScreen("auth");
  }
}

// ── Auth: sign up ────────────────────────────────────────────────────────────

document.getElementById("sp-signup-btn").addEventListener("click", async () => {
  const emailInput = document.getElementById("sp-email-input");
  const email = emailInput.value.trim();
  if (!email || !email.includes("@")) {
    emailInput.classList.add("error");
    emailInput.focus();
    setTimeout(() => emailInput.classList.remove("error"), 1800);
    return;
  }

  const btn = document.getElementById("sp-signup-btn");
  btn.disabled = true;
  btn.textContent = "Sending…";

  app.deviceId = crypto.randomUUID();
  await storageSet({ clasp_device_id: app.deviceId, clasp_email: email });

  try {
    const res = await fetch(`${SERVER_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, deviceId: app.deviceId }),
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "Request failed"));
    app.email = email;
    document.getElementById("sp-verify-email").textContent = email;
    showScreen("verifying");
    startDevicePoll();
  } catch {
    btn.disabled = false;
    btn.textContent = "Get free API key";
    emailInput.classList.add("error");
    setTimeout(() => emailInput.classList.remove("error"), 1800);
  }
});

document.getElementById("sp-email-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("sp-signup-btn").click();
});

// ── Auth: paste key ──────────────────────────────────────────────────────────

document.getElementById("sp-key-save-btn").addEventListener("click", () => saveKey());
document.getElementById("sp-key-input").addEventListener("keydown", e => {
  if (e.key === "Enter") saveKey();
});

async function saveKey() {
  const input = document.getElementById("sp-key-input");
  const key = input.value.trim();
  if (!key) { input.focus(); return; }

  app.apiKey = key;
  await storageSet({ bp_api_key: key });
  applyPlanGating();
  initToggleListeners();
  await loadToggleValues();
  showScreen("main");
  startStatusPolling();
  fetchAuthInfo();
}

// ── Auth: device polling ─────────────────────────────────────────────────────

function startDevicePoll() {
  stopDevicePoll();
  app.pollTimer = setInterval(pollDevice, 2000);
}

function stopDevicePoll() {
  if (app.pollTimer) { clearInterval(app.pollTimer); app.pollTimer = null; }
}

async function pollDevice() {
  if (!app.deviceId) return;
  try {
    const res = await fetch(`${SERVER_URL}/auth/poll/${app.deviceId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === "verified" && data.apiKey) {
      stopDevicePoll();
      app.apiKey = data.apiKey;
      app.plan   = data.plan || "free";
      await storageRemove(["clasp_device_id"]);
      await storageSet({ bp_api_key: data.apiKey, clasp_email: app.email, clasp_plan: app.plan });
      applyPlanGating();
      initToggleListeners();
      await loadToggleValues();
      showScreen("main");
      startStatusPolling();
      fetchAuthInfo();
      renderOnboarding();
    } else if (data.status === "expired") {
      stopDevicePoll();
      await storageRemove(["clasp_device_id"]);
      showScreen("auth");
    }
  } catch {
    // keep polling
  }
}

document.getElementById("sp-verify-back-btn").addEventListener("click", async () => {
  stopDevicePoll();
  await storageRemove(["clasp_device_id"]);
  showScreen("auth");
});

// ── Auth info (background refresh) ──────────────────────────────────────────

async function fetchAuthInfo() {
  if (!app.apiKey) return;
  try {
    const res = await fetch(`${SERVER_URL}/auth/info`, {
      headers: { "X-API-Key": app.apiKey },
    });
    if (!res.ok) return;
    const data = await res.json();
    app.email = data.email || app.email;
    app.plan  = data.plan  || app.plan;
    if (app.plan === "pro") { app.limitDate = null; }
    await storageSet({ clasp_email: app.email, clasp_plan: app.plan, clasp_limit_date: app.limitDate });
    applyPlanGating();
    renderHeader();
    updatePickButton();
  } catch {}
}

// ── Pick flow ────────────────────────────────────────────────────────────────

document.getElementById("sp-pick-btn").addEventListener("click", startPicking);

async function startPicking() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setPickStatus("No active tab found");
    return;
  }

  // Try direct send first (content script already running)
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START_PICKING" });
    showScreen("picking");
    return;
  } catch { /* not loaded or connection stale — fall through to inject */ }

  // Re-inject: reset flag so content.js re-initialises cleanly
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__claspItLoaded = false; },
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
    await chrome.tabs.sendMessage(tab.id, { type: "START_PICKING" });
    showScreen("picking");
  } catch {
    setPickStatus("Can't pick on this page — try a regular website");
  }
}

function setPickStatus(msg) {
  const el = document.getElementById("sp-pick-status");
  if (!el) return;
  el.textContent = msg;
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3000);
}

document.getElementById("sp-cancel-btn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "CANCEL_PICKING" }).catch(() => {});
  showScreen("main");
});

async function getActiveTab() {
  // lastFocusedWindow is more reliable than currentWindow from a side panel context
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

// ── Messages from content script ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ELEMENT_PICKED") {
    if (message.quickSend) {
      handleQuickSend(message.elementData, message.prompt || "");
    } else {
      showPicked(message.elementData);
    }
    sendResponse({ ok: true });
  } else if (message.type === "PICKER_CANCELLED") {
    if (app.screen === "picking") showScreen("main");
    sendResponse({ ok: true });
  }
  return false;
});

// ── Show picked form ──────────────────────────────────────────────────────────

function showPicked(elementData) {
  app.currentElement = elementData;

  const label = elementData.tagName + (elementData.classList?.[0] ? `.${elementData.classList[0]}` : "");
  document.getElementById("sp-element-tag").textContent = label;

  const urlEl = document.getElementById("sp-element-url");
  urlEl.textContent = elementData.pageURL || "";
  urlEl.title = elementData.pageURL || "";

  const trReact = document.getElementById("tr-react");
  if (trReact) trReact.style.display = elementData.hasReact ? "flex" : "none";

  document.getElementById("sp-prompt").value = "";
  setStatus("", "");
  showScreen("picked");
}

// ── Feature gating ────────────────────────────────────────────────────────────

function applyPlanGating() {
  const isPro = app.plan === "pro";
  PRO_TOGGLE_IDS.forEach(id => {
    const cb  = document.getElementById(id);
    const row = document.getElementById("tr-" + id.replace("sp-toggle-", ""));
    const tag = document.getElementById("pro-" + id.replace("sp-toggle-", ""));
    if (!cb) return;
    if (isPro) {
      cb.disabled = false;
      row?.classList.remove("sp-locked");
      if (tag) tag.style.display = "none";
    } else {
      cb.disabled = true;
      cb.checked = false;
      row?.classList.add("sp-locked");
      if (tag) tag.style.display = "";
    }
  });
}

// ── Toggles ───────────────────────────────────────────────────────────────────

function initToggleListeners() {
  if (app.toggleListenersAdded) return;
  app.toggleListenersAdded = true;

  PRO_TOGGLE_IDS.forEach(id => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.addEventListener("change", () => {
      if (!cb.disabled) storageSet({ [id]: cb.checked });
    });
  });

  // Click on a non-locked toggle row toggles the checkbox
  document.querySelectorAll(".sp-toggle-row:not(.sp-locked)").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "LABEL") return;
      const cb = row.querySelector("input[type=checkbox]");
      if (cb && !cb.disabled) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      }
    });
  });
}

async function loadToggleValues() {
  const saved = await storageGet(PRO_TOGGLE_IDS);
  PRO_TOGGLE_IDS.forEach(id => {
    const cb = document.getElementById(id);
    if (!cb || cb.disabled) return;
    if (id in saved) cb.checked = !!saved[id];
  });
}

// ── Send ──────────────────────────────────────────────────────────────────────

document.getElementById("sp-send-btn").addEventListener("click", handleSend);

async function handleSend() {
  const el = app.currentElement;
  if (!el) return;

  const sendBtn = document.getElementById("sp-send-btn");
  sendBtn.disabled = true;
  setStatus("Collecting context…");

  const prompt  = document.getElementById("sp-prompt")?.value ?? "";
  const toggles = readToggles();
  const result  = await doSend(el, prompt, toggles);

  sendBtn.disabled = false;

  if (result.pickId) {
    setStatus("Sent to Claude Code!", "ok");
    await addHistoryItem({
      id:           crypto.randomUUID(),
      pickId:       result.pickId,
      elementLabel: el.tagName + (el.classList?.[0] ? `.${el.classList[0]}` : ""),
      pageURL:      el.pageURL || "",
      prompt,
      status:       "not_started",
      sentAt:       Date.now(),
    });
    setTimeout(() => showScreen("main"), 1200);
  } else {
    setStatus(result.error || "Send failed", "err");
  }
}

async function handleQuickSend(elementData, prompt = "") {
  app.currentElement = elementData;
  const label = elementData.tagName + (elementData.classList?.[0] ? `.${elementData.classList[0]}` : "");

  // Optimistically add a "sending" history card and switch to main immediately
  const item = {
    id:           crypto.randomUUID(),
    pickId:       null,
    elementLabel: label,
    pageURL:      elementData.pageURL || "",
    prompt,
    status:       "not_started",
    sentAt:       Date.now(),
  };
  await addHistoryItem(item);
  showScreen("main");

  const toggles = readToggles();
  const result  = await doSend(elementData, prompt, toggles);
  if (result.pickId) {
    // Patch the history item with the real pickId
    app.history = app.history.map(h => h.id === item.id ? { ...h, pickId: result.pickId } : h);
    await storageSet({ clasp_history: app.history });
    if (app.screen === "main") renderHistory();
  } else {
    // Remove the failed history item
    app.history = app.history.filter(h => h.id !== item.id);
    // If rate limited, set the limit flag for today
    if (result.error?.toLowerCase().includes("limit")) {
      app.limitDate = new Date().toDateString();
      await storageSet({ clasp_history: app.history, clasp_limit_date: app.limitDate });
    } else {
      await storageSet({ clasp_history: app.history });
    }
    if (app.screen === "main") {
      renderHistory();
      updatePickButton();
    }
  }
}

function readToggles() {
  return {
    dom:        true,
    styles:     true,
    screenshot: !!document.getElementById("sp-toggle-screenshot")?.checked,
    console:    !!document.getElementById("sp-toggle-console")?.checked,
    network:    !!document.getElementById("sp-toggle-network")?.checked,
    react:      !!document.getElementById("sp-toggle-react")?.checked,
    parent:     !!document.getElementById("sp-toggle-parent")?.checked,
  };
}

async function doSend(elementData, prompt, toggles) {
  const payload = {
    prompt,
    element: {
      selector:       elementData.selector,
      tagName:        elementData.tagName,
      id:             elementData.id,
      classList:      elementData.classList,
      attributes:     elementData.attributes,
      innerText:      elementData.innerText,
      innerHTML:      elementData.innerHTML,
      computedStyles: elementData.computedStyles,
      dimensions:     elementData.dimensions,
      pageURL:        elementData.pageURL,
      pageTitle:      elementData.pageTitle,
    },
    toggles,
  };

  if (toggles.parent && elementData.parentHTML) {
    payload.element.parentHTML = elementData.parentHTML;
  }

  if (toggles.screenshot) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
      if (resp?.dataUrl) payload.screenshot = resp.dataUrl;
    } catch {}
  }

  if (toggles.console) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_CONSOLE_LOGS" });
      if (resp?.logs) payload.consoleLogs = resp.logs;
    } catch {}
  }

  if (toggles.network) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_NETWORK_REQUESTS" });
      if (resp?.requests) payload.networkRequests = resp.requests;
    } catch {}
  }

  try {
    const res = await fetch(`${SERVER_URL}/element-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(app.apiKey ? { "X-API-Key": app.apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        return { error: data.error || "Daily pick limit reached. Upgrade to Pro for unlimited picks." };
      }
      const text = await res.text().catch(() => res.statusText);
      return { error: `Error ${res.status}: ${text}` };
    }

    const data = await res.json().catch(() => ({}));
    return { pickId: data.pickId || data.id || null };
  } catch (err) {
    return { error: err.message };
  }
}

function setStatus(msg, type = "") {
  const el = document.getElementById("sp-send-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "sp-status-line" + (type ? " " + type : "");
}

async function startCheckout() {
  const upgradeLink = document.getElementById("settings-upgrade-link");
  const original = upgradeLink?.textContent;
  if (upgradeLink) { upgradeLink.textContent = "Opening…"; upgradeLink.style.pointerEvents = "none"; }

  try {
    const res = await fetch(`${SERVER_URL}/billing/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(app.apiKey ? { "Authorization": `Bearer ${app.apiKey}` } : {}),
      },
      body: JSON.stringify({ plan: "pro", billing: "monthly" }),
    });
    const data = await res.json();
    if (data.url) {
      chrome.tabs.create({ url: data.url });
    } else {
      console.error("[checkout]", data.error);
      if (upgradeLink) upgradeLink.textContent = data.error || "Something went wrong — try again";
    }
  } catch (err) {
    console.error("[checkout]", err.message);
    if (upgradeLink) upgradeLink.textContent = "Network error — try again";
  } finally {
    if (upgradeLink) {
      upgradeLink.style.pointerEvents = "";
      setTimeout(() => { if (upgradeLink.textContent !== original) upgradeLink.textContent = original; }, 3000);
    }
  }
}

function updatePickButton() {
  const btn = document.getElementById("sp-pick-btn");
  const banner = document.getElementById("sp-limit-banner");
  if (!btn || !banner) return;

  if (app.plan === "pro") {
    btn.disabled = false;
    banner.style.display = "none";
    return;
  }

  const today = new Date().toDateString();
  // Clear stale flag from a previous day
  if (app.limitDate && app.limitDate !== today) {
    app.limitDate = null;
    storageSet({ clasp_limit_date: null });
  }

  const atLimit = app.limitDate === today;
  btn.disabled = atLimit;
  banner.style.display = atLimit ? "flex" : "none";
}

// ── History ───────────────────────────────────────────────────────────────────

async function addHistoryItem(item) {
  const max = app.plan === "pro" ? 50 : 10;
  app.history = [item, ...app.history].slice(0, max);
  await storageSet({ clasp_history: app.history });
  if (app.screen === "main") renderHistory();
}

function renderHistory() {
  const list  = document.getElementById("sp-history-list");
  const empty = document.getElementById("sp-history-empty");
  if (!list) return;

  // Update today's pick counter
  const counter = document.getElementById("sp-picks-counter");
  if (counter && app.plan !== "pro") {
    const today = new Date().toDateString();
    const todayCount = app.history.filter(h => new Date(h.sentAt).toDateString() === today).length;
    const atLimit = app.limitDate === today;
    counter.textContent = atLimit ? "10/10 today" : `${todayCount}/10 today`;
  } else if (counter) {
    counter.textContent = "";
  }

  list.innerHTML = "";

  if (!app.history.length) {
    if (empty) empty.style.display = "";
    return;
  }

  if (empty) empty.style.display = "none";

  const tip = document.getElementById("sp-claude-tip");
  if (tip) tip.style.display = app.history.some(h => h.status !== "completed") ? "" : "none";

  for (const item of app.history) {
    const statusLabel = { not_started: "Waiting", in_progress: "In progress", completed: "Done" }[item.status] || "Waiting";
    const statusClass = item.status || "not_started";
    const canDelete = !item.status || item.status === "not_started";

    const row = document.createElement("div");
    row.className = "sp-history-item";
    row.dataset.id = item.id;

    const body = document.createElement("div");
    body.className = "sp-history-body";

    const labelEl = document.createElement("div");
    labelEl.className = "sp-history-label";
    labelEl.textContent = item.elementLabel || "element";
    body.appendChild(labelEl);

    if (item.prompt) {
      const promptEl = document.createElement("div");
      promptEl.className = "sp-history-prompt";
      promptEl.textContent = item.prompt;
      body.appendChild(promptEl);
    }

    const meta = document.createElement("div");
    meta.className = "sp-history-meta";
    const url = shortUrl(item.pageURL || "");
    meta.textContent = (url ? url + " · " : "") + relativeTime(item.sentAt);
    body.appendChild(meta);

    row.appendChild(body);

    if (canDelete) {
      const btn = document.createElement("button");
      btn.className = "sp-delete-btn";
      btn.title = "Delete";
      btn.textContent = "✕";
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        app.history = app.history.filter(h => h.id !== item.id);
        await storageSet({ clasp_history: app.history });
        renderHistory();
      });
      row.appendChild(btn);
    } else {
      const badge = document.createElement("span");
      badge.className = `sp-status-badge ${statusClass}`;
      badge.textContent = statusLabel;
      row.appendChild(badge);
    }

    list.appendChild(row);
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname.slice(0, 24) : "");
  } catch {
    return url.slice(0, 30);
  }
}

function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000)   return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Status polling ────────────────────────────────────────────────────────────

function startStatusPolling() {
  stopStatusPolling();
  app.statusPollTimer = setInterval(pollStatuses, 5000);
}

function stopStatusPolling() {
  if (app.statusPollTimer) { clearInterval(app.statusPollTimer); app.statusPollTimer = null; }
}

async function pollStatuses() {
  if (!app.apiKey || !app.history.length) return;
  const ids = app.history
    .filter(h => h.status !== "completed" && h.pickId)
    .slice(0, 20)
    .map(h => h.pickId);
  if (!ids.length) return;

  try {
    const res = await fetch(`${SERVER_URL}/picks/statuses?ids=${ids.join(",")}`, {
      headers: { "X-API-Key": app.apiKey },
    });
    if (!res.ok) return;
    const map = await res.json();

    let changed = false;
    app.history = app.history.map(item => {
      if (item.pickId && map[item.pickId] && map[item.pickId] !== item.status) {
        changed = true;
        return { ...item, status: map[item.pickId] };
      }
      return item;
    });

    if (changed) {
      await storageSet({ clasp_history: app.history });
      if (app.screen === "main") renderHistory();
    }
  } catch {}
}

// ── Onboarding card ───────────────────────────────────────────────────────────

const MCP_CMD_TEMPLATE = `claude mcp add --scope user --transport http clasp-it https://claspit.dev/mcp --header "Authorization: Bearer YOUR_KEY"`;

async function renderOnboarding() {
  const card = document.getElementById("sp-onboarding-card");
  if (!card || !app.apiKey) return;

  const { clasp_mcp_dismissed } = await storageGet(["clasp_mcp_dismissed"]);
  if (clasp_mcp_dismissed) { card.style.display = "none"; return; }

  const fullCmd = MCP_CMD_TEMPLATE.replace("YOUR_KEY", app.apiKey);
  const maskedCmd = MCP_CMD_TEMPLATE.replace("YOUR_KEY", app.apiKey.slice(0, 6) + "••••••••••••");

  const cmdEl = document.getElementById("sp-onboarding-cmd");
  if (cmdEl) {
    cmdEl.textContent = maskedCmd;
    cmdEl.onclick = () => {
      navigator.clipboard.writeText(fullCmd).then(() => {
        const orig = cmdEl.textContent;
        cmdEl.textContent = "Copied!";
        setTimeout(() => { cmdEl.textContent = orig; }, 1500);
      }).catch(() => {});
    };
  }

  card.style.display = "";
}

document.getElementById("sp-onboarding-dismiss").addEventListener("click", async () => {
  await storageSet({ clasp_mcp_dismissed: true });
  document.getElementById("sp-onboarding-card").style.display = "none";
});

// ── Header ────────────────────────────────────────────────────────────────────

function renderHeader() {
  const emailEl = document.getElementById("sp-header-email");
  const planEl  = document.getElementById("sp-header-plan");
  if (emailEl) emailEl.textContent = app.email || "";
  if (planEl) {
    planEl.textContent = app.plan === "pro" ? "Pro" : "Free";
    planEl.className = `sp-plan-badge ${app.plan === "pro" ? "pro" : "free"}`;
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

document.getElementById("sp-settings-btn").addEventListener("click", () => showScreen("settings"));
document.getElementById("sp-settings-back-btn").addEventListener("click", () => showScreen("main"));

document.getElementById("sp-limit-upgrade").addEventListener("click", async (e) => {
  e.preventDefault();
  startCheckout();
});

document.getElementById("sp-limit-refresh").addEventListener("click", async (e) => {
  e.preventDefault();
  const el = e.target;
  el.textContent = "Checking…";
  await fetchAuthInfo();
  el.textContent = "Already upgraded? Refresh ↺";
});

document.getElementById("sp-signout-btn").addEventListener("click", async () => {
  stopDevicePoll();
  stopStatusPolling();
  await storageRemove(["bp_api_key", "clasp_email", "clasp_plan", "clasp_history"]);
  Object.assign(app, { apiKey: null, email: null, plan: "free", history: [], deviceId: null, toggleListenersAdded: false });
  showScreen("auth");
});

document.getElementById("settings-key-chip").addEventListener("click", () => {
  if (app.apiKey) navigator.clipboard.writeText(app.apiKey).catch(() => {});
});

function renderSettings() {
  document.getElementById("settings-email").textContent = app.email || "—";

  const badge = document.getElementById("settings-plan-badge");
  badge.textContent = app.plan === "pro" ? "Pro" : "Free";
  badge.className = `sp-plan-badge ${app.plan === "pro" ? "pro" : "free"}`;

  const upgradeLink = document.getElementById("settings-upgrade-link");
  if (app.plan !== "pro") {
    upgradeLink.style.display = "";
    upgradeLink.href = "#";
    upgradeLink.onclick = (e) => { e.preventDefault(); startCheckout(); };
  } else {
    upgradeLink.style.display = "none";
  }

  const chip = document.getElementById("settings-key-chip");
  if (app.apiKey) {
    chip.textContent = app.apiKey.slice(0, 10) + "••••••";
    chip.title = "Click to copy";
  } else {
    chip.textContent = "—";
  }

  // Show masked key in all MCP config blocks
  if (app.apiKey) {
    const masked = app.apiKey.slice(0, 6) + "••••••••••••";
    const mcpCmd = document.getElementById("sp-mcp-cmd");
    if (mcpCmd) mcpCmd.textContent = MCP_CMD_TEMPLATE.replace("YOUR_KEY", masked);
    const cursorCfg = document.getElementById("sp-mcp-cursor-cfg");
    if (cursorCfg) cursorCfg.textContent = cursorCfg.textContent.replace("YOUR_KEY", masked);
    const windsurfCfg = document.getElementById("sp-mcp-windsurf-cfg");
    if (windsurfCfg) windsurfCfg.textContent = windsurfCfg.textContent.replace("YOUR_KEY", masked);
  }
}

// ── MCP setup toggle ─────────────────────────────────────────────────────────

document.getElementById("sp-mcp-toggle").addEventListener("click", () => {
  const body    = document.getElementById("sp-mcp-body");
  const chevron = document.getElementById("sp-mcp-chevron");
  const open    = body.classList.toggle("open");
  chevron.style.transform = open ? "rotate(180deg)" : "";
});

// MCP editor tabs
document.querySelectorAll(".sp-mcp-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".sp-mcp-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".sp-mcp-tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`sp-mcp-tab-${tab.dataset.tab}`)?.classList.add("active");
  });
});

// Click-to-copy for all MCP code blocks
document.querySelectorAll(".sp-mcp-code").forEach(el => {
  el.addEventListener("click", function () {
    const template = this.dataset.template || this.textContent;
    const text = app.apiKey ? template.replace("YOUR_KEY", app.apiKey) : template;
    navigator.clipboard.writeText(text).then(() => {
      const orig = this.textContent;
      this.textContent = "Copied!";
      setTimeout(() => { this.textContent = orig; }, 1500);
    }).catch(() => {});
  });
});

// ── Cleanup on panel close ────────────────────────────────────────────────────

window.addEventListener("pagehide", async () => {
  const tab = await getActiveTab().catch(() => null);
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "PANEL_CLOSING" }).catch(() => {});
});

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
