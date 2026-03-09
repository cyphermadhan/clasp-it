// Content script — Clasp It for Claude Code
// Injected at document_idle on all pages.

const SERVER_URL = "https://clasp-it-production.up.railway.app";

// ── State ─────────────────────────────────────────────────────────────────────
let pickerActive = false;
let highlightOverlay = null;
let tooltip = null;
let currentTarget = null;

// ── Console interception (forwards to background for buffering) ───────────────
(function interceptConsole() {
  const levels = ["log", "warn", "error", "info", "debug"];
  levels.forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        const serialized = args.map((a) => {
          try {
            return typeof a === "object" ? JSON.stringify(a) : String(a);
          } catch {
            return String(a);
          }
        });
        chrome.runtime.sendMessage({
          type: "CONSOLE_LOG",
          level,
          args: serialized,
          timestamp: Date.now(),
        });
      } catch {
        // Extension context may be invalidated — fail silently.
      }
    };
  });
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a unique CSS selector for `el` by walking up the DOM. */
function generateUniqueSelector(el) {
  if (!el || el === document.body) return "body";
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts = [];
  let node = el;

  while (node && node !== document.body && node.nodeType === Node.ELEMENT_NODE) {
    let segment = node.tagName.toLowerCase();

    if (node.id) {
      segment = `#${CSS.escape(node.id)}`;
      parts.unshift(segment);
      break; // ID is unique — stop here
    }

    // Add first meaningful class
    if (node.classList && node.classList.length > 0) {
      const firstClass = [...node.classList]
        .find((c) => c && !/^\d/.test(c) && /^[\w-]+$/.test(c));
      if (firstClass) segment += `.${CSS.escape(firstClass)}`;
    }

    // Add :nth-child for disambiguation
    const parent = node.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(
        (c) => c.tagName === node.tagName
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node) + 1;
        segment += `:nth-of-type(${idx})`;
      }
    }

    parts.unshift(segment);
    node = node.parentElement;
  }

  return parts.join(" > ");
}

/** Extract a curated set of computed styles from an element. */
function getCriticalStyles(el) {
  const cs = window.getComputedStyle(el);
  const props = [
    "display", "position", "width", "height",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "fontSize", "fontFamily", "fontWeight", "lineHeight", "letterSpacing",
    "color", "backgroundColor",
    "border", "borderRadius", "boxShadow",
    "opacity", "zIndex",
    "flexDirection", "alignItems", "justifyContent", "gap",
    "overflow", "textAlign", "cursor",
  ];
  const result = {};
  props.forEach((p) => (result[p] = cs[p]));
  return result;
}

/** Check whether the element (or an ancestor) is inside a React tree. */
function detectReact(el) {
  if (!el) return false;
  const keys = Object.keys(el);
  const fiberKey = keys.find(
    (k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")
  );
  if (fiberKey) return true;
  // Walk up a few levels
  const parent = el.parentElement;
  if (parent && parent !== document.body) return detectReact(parent);
  return false;
}

/** Collect all data about a picked element. */
function collectElementData(el) {
  const rect = el.getBoundingClientRect();
  const attributes = {};
  for (const attr of el.attributes) {
    attributes[attr.name] = attr.value;
  }

  return {
    selector: generateUniqueSelector(el),
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    classList: [...el.classList],
    attributes,
    innerText: (el.innerText || "").slice(0, 200),
    innerHTML: el.innerHTML.slice(0, 500),
    computedStyles: getCriticalStyles(el),
    dimensions: {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      x: rect.x,
      y: rect.y,
    },
    parentHTML: el.parentElement
      ? el.parentElement.outerHTML.slice(0, 500)
      : null,
    pageURL: window.location.href,
    pageTitle: document.title,
    hasReact: detectReact(el),
  };
}

// ── Picker overlay UI ─────────────────────────────────────────────────────────

function createHighlightOverlay() {
  const div = document.createElement("div");
  div.id = "bp-highlight-overlay";
  document.body.appendChild(div);
  return div;
}

function createTooltip() {
  const div = document.createElement("div");
  div.id = "bp-tooltip";
  document.body.appendChild(div);
  return div;
}

function moveHighlight(el) {
  if (!highlightOverlay) return;
  const rect = el.getBoundingClientRect();
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.display = "block";

  if (tooltip) {
    const tag = el.tagName.toLowerCase();
    const cls = el.classList[0] ? `.${el.classList[0]}` : "";
    tooltip.textContent = `${tag}${cls}`;
    // Position tooltip above the element; fall back below if near top
    const tipTop = rect.top - 26;
    tooltip.style.top = `${tipTop > 0 ? tipTop : rect.bottom + 4}px`;
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.display = "block";
  }
}

function hideHighlight() {
  if (highlightOverlay) highlightOverlay.style.display = "none";
  if (tooltip) tooltip.style.display = "none";
}

// ── Picker event handlers ─────────────────────────────────────────────────────

function onMouseOver(e) {
  currentTarget = e.target;
  moveHighlight(currentTarget);
}

function onPickerClick(e) {
  if (!pickerActive) return;
  e.preventDefault();
  e.stopPropagation();

  const el = currentTarget || e.target;
  deactivatePicker();
  const data = collectElementData(el);
  injectPanel(data);
}

function activatePicker() {
  if (pickerActive) return;
  pickerActive = true;
  document.body.style.cursor = "crosshair";

  if (!highlightOverlay) highlightOverlay = createHighlightOverlay();
  if (!tooltip) tooltip = createTooltip();

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("click", onPickerClick, true);
}

function deactivatePicker() {
  pickerActive = false;
  document.body.style.cursor = "";
  hideHighlight();
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onPickerClick, true);
}

// ── Panel ─────────────────────────────────────────────────────────────────────

const PANEL_TEMPLATE = (elementData) => {
  const label =
    elementData.tagName +
    (elementData.classList[0] ? `.${elementData.classList[0]}` : "");
  const showReact = elementData.hasReact;

  return `
<div id="bp-panel">
  <div id="bp-header">
    <span id="bp-element-label">${escapeHTML(label)}</span>
    <button id="bp-close" title="Close">✕</button>
  </div>
  <div id="bp-url" title="${escapeHTML(elementData.pageURL)}">${escapeHTML(
    truncate(elementData.pageURL, 60)
  )}</div>
  <hr/>
  <div id="bp-toggles">
    <label><input type="checkbox" id="bp-toggle-dom" checked disabled> DOM &amp; Selector <em>(always on)</em></label>
    <label><input type="checkbox" id="bp-toggle-styles" checked disabled> Computed Styles <em>(always on)</em></label>
    <label><input type="checkbox" id="bp-toggle-screenshot"> Screenshot</label>
    <label><input type="checkbox" id="bp-toggle-console"> Console Logs</label>
    <label><input type="checkbox" id="bp-toggle-network"> Network Requests</label>
    <label id="bp-react-label" style="${showReact ? "" : "display:none"}"><input type="checkbox" id="bp-toggle-react"> React Props</label>
    <label><input type="checkbox" id="bp-toggle-parent"> Parent DOM Context</label>
  </div>
  <div id="bp-presets">
    <button data-preset="style">Style fix</button>
    <button data-preset="debug">Debug</button>
    <button data-preset="redesign">Redesign</button>
    <button data-preset="full">Full</button>
  </div>
  <textarea id="bp-prompt" placeholder="Describe what to change..."></textarea>
  <div id="bp-api-key-section" style="display:none">
    <p>🔑 Connect your account</p>
    <input type="text" id="bp-api-key-input" placeholder="Paste API key..."/>
    <button id="bp-api-key-save">Save</button>
    <a href="${SERVER_URL}" target="_blank">Get a free key →</a>
  </div>
  <div id="bp-actions">
    <button id="bp-pick-another">Pick another</button>
    <button id="bp-send">Send to Claude Code →</button>
  </div>
  <div id="bp-status"></div>
</div>
`;
};

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

/** Preset definitions: which toggle IDs to check. */
const PRESETS = {
  style: ["bp-toggle-dom", "bp-toggle-styles"],
  debug: ["bp-toggle-dom", "bp-toggle-styles", "bp-toggle-console", "bp-toggle-network"],
  redesign: ["bp-toggle-dom", "bp-toggle-styles", "bp-toggle-screenshot", "bp-toggle-react"],
  full: [
    "bp-toggle-dom",
    "bp-toggle-styles",
    "bp-toggle-screenshot",
    "bp-toggle-console",
    "bp-toggle-network",
    "bp-toggle-react",
    "bp-toggle-parent",
  ],
};

const TOGGLE_IDS = [
  "bp-toggle-screenshot",
  "bp-toggle-console",
  "bp-toggle-network",
  "bp-toggle-react",
  "bp-toggle-parent",
];

async function loadToggleState(toggleIds) {
  return new Promise((resolve) => {
    chrome.storage.local.get(toggleIds, (result) => resolve(result));
  });
}

async function saveToggleState(toggleId, value) {
  chrome.storage.local.set({ [toggleId]: value });
}

async function injectPanel(elementData) {
  // Remove any existing panel
  removePanel();

  const wrapper = document.createElement("div");
  wrapper.id = "bp-panel-wrapper";
  wrapper.innerHTML = PANEL_TEMPLATE(elementData);
  document.body.appendChild(wrapper);

  const panel = document.getElementById("bp-panel");
  if (!panel) return;

  // ── Restore persisted toggle state
  const savedState = await loadToggleState(TOGGLE_IDS);
  TOGGLE_IDS.forEach((id) => {
    const checkbox = document.getElementById(id);
    if (checkbox && !checkbox.disabled && id in savedState) {
      checkbox.checked = !!savedState[id];
    }
  });

  // ── Check for API key
  const apiKeySection = document.getElementById("bp-api-key-section");
  const sendBtn = document.getElementById("bp-send");

  chrome.storage.local.get(["bp_api_key"], ({ bp_api_key }) => {
    if (!bp_api_key) {
      if (apiKeySection) apiKeySection.style.display = "block";
      if (sendBtn) sendBtn.style.display = "none";
    }
  });

  // ── Save API key
  const apiKeySaveBtn = document.getElementById("bp-api-key-save");
  if (apiKeySaveBtn) {
    apiKeySaveBtn.addEventListener("click", () => {
      const input = document.getElementById("bp-api-key-input");
      const key = input ? input.value.trim() : "";
      if (!key) return;
      chrome.storage.local.set({ bp_api_key: key }, () => {
        if (apiKeySection) apiKeySection.style.display = "none";
        if (sendBtn) sendBtn.style.display = "inline-block";
        setStatus("API key saved.", "success");
      });
    });
  }

  // ── Persist toggle changes
  TOGGLE_IDS.forEach((id) => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener("change", () => saveToggleState(id, checkbox.checked));
    }
  });

  // ── Presets
  document.querySelectorAll("#bp-presets [data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetIds = PRESETS[btn.dataset.preset] || [];
      TOGGLE_IDS.forEach((id) => {
        const cb = document.getElementById(id);
        if (cb && !cb.disabled) {
          cb.checked = presetIds.includes(id);
          saveToggleState(id, cb.checked);
        }
      });
    });
  });

  // ── Close button
  const closeBtn = document.getElementById("bp-close");
  if (closeBtn) closeBtn.addEventListener("click", removePanel);

  // ── Pick another
  const pickAnotherBtn = document.getElementById("bp-pick-another");
  if (pickAnotherBtn) {
    pickAnotherBtn.addEventListener("click", () => {
      removePanel();
      activatePicker();
    });
  }

  // ── Send
  if (sendBtn) {
    sendBtn.addEventListener("click", () => handleSend(elementData));
  }
}

function removePanel() {
  const w = document.getElementById("bp-panel-wrapper");
  if (w) w.remove();
}

function setStatus(msg, type = "info") {
  const el = document.getElementById("bp-status");
  if (!el) return;
  el.textContent = msg;
  el.className = type; // "success" | "error" | "info"
}

async function handleSend(elementData) {
  const sendBtn = document.getElementById("bp-send");
  if (sendBtn) sendBtn.disabled = true;
  setStatus("Collecting data…", "info");

  // Enabled toggles
  const toggleScreenshot = document.getElementById("bp-toggle-screenshot")?.checked;
  const toggleConsole = document.getElementById("bp-toggle-console")?.checked;
  const toggleNetwork = document.getElementById("bp-toggle-network")?.checked;
  const toggleReact = document.getElementById("bp-toggle-react")?.checked;
  const toggleParent = document.getElementById("bp-toggle-parent")?.checked;
  const prompt = document.getElementById("bp-prompt")?.value || "";

  // Build payload
  const payload = {
    prompt,
    element: {
      selector: elementData.selector,
      tagName: elementData.tagName,
      id: elementData.id,
      classList: elementData.classList,
      attributes: elementData.attributes,
      innerText: elementData.innerText,
      innerHTML: elementData.innerHTML,
      computedStyles: elementData.computedStyles,
      dimensions: elementData.dimensions,
      pageURL: elementData.pageURL,
      pageTitle: elementData.pageTitle,
    },
    toggles: {
      dom: true,
      styles: true,
      screenshot: !!toggleScreenshot,
      console: !!toggleConsole,
      network: !!toggleNetwork,
      react: !!toggleReact,
      parent: !!toggleParent,
    },
  };

  if (toggleParent && elementData.parentHTML) {
    payload.element.parentHTML = elementData.parentHTML;
  }

  // Screenshot
  if (toggleScreenshot) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
      if (resp && resp.dataUrl) payload.screenshot = resp.dataUrl;
    } catch (err) {
      console.warn("[ClaspIt] Screenshot failed:", err);
    }
  }

  // Console logs
  if (toggleConsole) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_CONSOLE_LOGS" });
      if (resp && resp.logs) payload.consoleLogs = resp.logs;
    } catch (err) {
      console.warn("[ClaspIt] Console logs failed:", err);
    }
  }

  // Network requests
  if (toggleNetwork) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_NETWORK_REQUESTS" });
      if (resp && resp.requests) payload.networkRequests = resp.requests;
    } catch (err) {
      console.warn("[ClaspIt] Network requests failed:", err);
    }
  }

  // API key
  const { bp_api_key } = await new Promise((res) =>
    chrome.storage.local.get(["bp_api_key"], res)
  );

  setStatus("Sending…", "info");

  try {
    const response = await fetch(`${SERVER_URL}/element-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bp_api_key ? { "X-API-Key": bp_api_key } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Server error ${response.status}: ${text}`);
    }

    const result = await response.json().catch(() => ({}));
    setStatus(result.message || "Sent to Claude Code!", "success");
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_PICKING") {
    activatePicker();
    sendResponse({ ok: true });
  } else if (message.type === "INJECT_PANEL") {
    // Allow background to inject panel with pre-collected data if needed
    if (message.elementData) injectPanel(message.elementData);
    sendResponse({ ok: true });
  }
  return false;
});
