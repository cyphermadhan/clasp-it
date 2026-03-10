// Content script — Clasp It for Claude Code
// Injected at document_idle on all pages.

const SERVER_URL = "https://clasp-it-production.up.railway.app";

// Guard: side panel sets __claspItLoaded = false before programmatic re-injection.
// Truthy value means script is already live — skip re-init.
if (window.__claspItLoaded) throw new Error();
window.__claspItLoaded = true;

// Remove any leftover DOM elements from a previous script instance
["clasp-float-dialog", "bp-highlight-overlay", "bp-tooltip"].forEach(id => {
  document.getElementById(id)?.remove();
});

// ── State ─────────────────────────────────────────────────────────────────────
let pickerActive = false;
let highlightOverlay = null;
let tooltip = null;
let floatingDialog = null;
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

// ── Floating prompt dialog ─────────────────────────────────────────────────────

function createFloatingDialog() {
  const div = document.createElement("div");
  div.id = "clasp-float-dialog";
  div.innerHTML = `
    <input id="clasp-float-input" type="text" placeholder="What to change?" autocomplete="off" spellcheck="false"/>
    <button id="clasp-float-submit">Clasp it!</button>
  `;
  // Stop clicks/mousedown on the dialog from triggering the element picker
  div.addEventListener("click", (e) => e.stopPropagation(), true);
  div.addEventListener("mousedown", (e) => e.stopPropagation(), true);
  document.body.appendChild(div);

  document.getElementById("clasp-float-submit").addEventListener("click", (e) => {
    e.stopPropagation();
    submitFloatingDialog();
  });

  document.getElementById("clasp-float-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submitFloatingDialog();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      deactivatePicker();
      chrome.runtime.sendMessage({ type: "PICKER_CANCELLED" }).catch(() => {});
    }
  });

  return div;
}

function positionFloatingDialog(el) {
  if (!floatingDialog) return;
  const rect = el.getBoundingClientRect();
  const dlgWidth = 260;
  const margin = 10;

  let left = rect.right + margin;
  if (left + dlgWidth > window.innerWidth - margin) {
    left = rect.left - dlgWidth - margin;
  }
  if (left < margin) left = margin;

  let top = rect.top;
  if (top + 46 > window.innerHeight - margin) {
    top = window.innerHeight - 46 - margin;
  }

  floatingDialog.style.left = `${left}px`;
  floatingDialog.style.top = `${top}px`;
  floatingDialog.style.display = "flex";
}

function hideFloatingDialog() {
  if (floatingDialog) floatingDialog.style.display = "none";
}

function submitFloatingDialog() {
  const input = document.getElementById("clasp-float-input");
  const prompt = input ? input.value.trim() : "";
  const el = currentTarget;
  if (!el) return;
  hideFloatingDialog();
  const data = collectElementData(el);
  chrome.runtime.sendMessage({ type: "ELEMENT_PICKED", elementData: data, prompt, quickSend: true }).catch(() => {});
  // Immediately reactivate so user can pick the next element
  activatePicker();
}

// ── Picker event handlers ─────────────────────────────────────────────────────

function onMouseOver(e) {
  if (e.target.closest("#clasp-float-dialog")) return;
  currentTarget = e.target;
  moveHighlight(currentTarget);
}

function onPickerClick(e) {
  if (!pickerActive) return;
  e.preventDefault();
  e.stopPropagation();

  currentTarget = currentTarget || e.target;
  const el = currentTarget;

  // Stop picking but keep dialog visible so user can type a prompt
  pickerActive = false;
  document.body.style.cursor = "";
  hideHighlight();
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onPickerClick, true);

  // Show prompt dialog next to the picked element
  if (!floatingDialog) floatingDialog = createFloatingDialog();
  const input = document.getElementById("clasp-float-input");
  if (input) { input.value = ""; }
  positionFloatingDialog(el);
  if (input) input.focus();
}

function onPickerEscape(e) {
  if (e.key === "Escape") {
    deactivatePicker();
    chrome.runtime.sendMessage({ type: "PICKER_CANCELLED" }).catch(() => {});
  }
}

function activatePicker() {
  if (pickerActive) return;
  pickerActive = true;
  document.body.style.cursor = "crosshair";

  if (!highlightOverlay) highlightOverlay = createHighlightOverlay();
  if (!tooltip) tooltip = createTooltip();
  if (!floatingDialog) floatingDialog = createFloatingDialog();
  hideFloatingDialog();

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("click", onPickerClick, true);
  document.addEventListener("keydown", onPickerEscape, true);
}

function deactivatePicker() {
  pickerActive = false;
  document.body.style.cursor = "";
  hideHighlight();
  hideFloatingDialog();
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("click", onPickerClick, true);
  document.removeEventListener("keydown", onPickerEscape, true);
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_PICKING") {
    activatePicker();
    sendResponse({ ok: true });
  } else if (message.type === "CANCEL_PICKING") {
    deactivatePicker();
    chrome.runtime.sendMessage({ type: "PICKER_CANCELLED" }).catch(() => {});
    sendResponse({ ok: true });
  } else if (message.type === "PANEL_CLOSING") {
    deactivatePicker();
    sendResponse({ ok: true });
  }
  return false;
});
