// Content script — Clasp It for Claude Code
// Injected at document_idle on all pages.

const SERVER_URL = "https://claspit.dev";

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
    <div id="clasp-float-header">
      <span id="clasp-float-label"></span>
      <button id="clasp-float-close" title="Cancel">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M13.424 5.51172C13.7169 5.21883 14.1916 5.21883 14.4845 5.51172C14.7773 5.80462 14.7774 6.27942 14.4845 6.57227L11.0578 9.99805L14.4845 13.4248C14.7772 13.7177 14.7773 14.1925 14.4845 14.4854C14.1917 14.7779 13.7168 14.7779 13.424 14.4854L9.99723 11.0586L6.57145 14.4854C6.27857 14.7778 5.80368 14.778 5.5109 14.4854C5.21821 14.1926 5.21839 13.7177 5.5109 13.4248L8.93668 9.99805L5.5109 6.57227C5.21811 6.27947 5.2183 5.80463 5.5109 5.51172C5.80379 5.21883 6.27856 5.21883 6.57145 5.51172L9.99723 8.9375L13.424 5.51172Z" fill="#141413"/>
        </svg>
      </button>
    </div>
    <div id="clasp-float-input-wrap">
      <div id="clasp-float-row-text">
        <textarea id="clasp-float-input" placeholder="What to change?" rows="2" autocomplete="off" spellcheck="false"></textarea>
      </div>
      <div id="clasp-float-row-actions">
        <button id="clasp-float-submit" title="Send">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.0306 7.53062C12.9609 7.60054 12.8781 7.65602 12.787 7.69387C12.6958 7.73173 12.5981 7.75121 12.4993 7.75121C12.4006 7.75121 12.3029 7.73173 12.2117 7.69387C12.1206 7.65602 12.0378 7.60054 11.9681 7.53062L8.74997 4.31249V13.5C8.74997 13.6989 8.67095 13.8897 8.5303 14.0303C8.38965 14.171 8.19889 14.25 7.99997 14.25C7.80106 14.25 7.61029 14.171 7.46964 14.0303C7.32899 13.8897 7.24997 13.6989 7.24997 13.5L7.24997 4.31249L4.0306 7.53062C3.8897 7.67152 3.69861 7.75067 3.49935 7.75067C3.30009 7.75067 3.10899 7.67152 2.9681 7.53062C2.8272 7.38972 2.74805 7.19863 2.74805 6.99937C2.74805 6.80011 2.8272 6.60902 2.9681 6.46812L7.4681 1.96812C7.53778 1.8982 7.62057 1.84272 7.71173 1.80487C7.8029 1.76701 7.90064 1.74753 7.99935 1.74753C8.09806 1.74753 8.1958 1.76701 8.28696 1.80487C8.37813 1.84272 8.46092 1.8982 8.5306 1.96812L13.0306 6.46812C13.1005 6.5378 13.156 6.62059 13.1938 6.71176C13.2317 6.80292 13.2512 6.90066 13.2512 6.99937C13.2512 7.09808 13.2317 7.19582 13.1938 7.28698C13.156 7.37815 13.1005 7.46094 13.0306 7.53062Z" fill="white"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  div.addEventListener("click", (e) => e.stopPropagation());
  div.addEventListener("mousedown", (e) => e.stopPropagation());
  document.body.appendChild(div);

  document.getElementById("clasp-float-close").addEventListener("click", (e) => {
    e.stopPropagation();
    deactivatePicker();
    chrome.runtime.sendMessage({ type: "PICKER_CANCELLED" }).catch(() => {});
  });

  document.getElementById("clasp-float-submit").addEventListener("click", (e) => {
    e.stopPropagation();
    submitFloatingDialog();
  });

  document.getElementById("clasp-float-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
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

  // Set element label in header
  const labelEl = document.getElementById("clasp-float-label");
  if (labelEl) {
    const tag = el.tagName.toLowerCase();
    const cls = el.classList[0] ? `.${el.classList[0]}` : "";
    labelEl.textContent = tag + cls;
  }

  const rect = el.getBoundingClientRect();
  const dlgWidth = 288;
  const dlgHeight = floatingDialog.offsetHeight || 180;
  const margin = 12;

  let left = rect.right + margin;
  if (left + dlgWidth > window.innerWidth - margin) {
    left = rect.left - dlgWidth - margin;
  }
  if (left < margin) left = margin;

  let top = rect.top;
  if (top + dlgHeight > window.innerHeight - margin) {
    top = window.innerHeight - dlgHeight - margin;
  }
  if (top < margin) top = margin;

  floatingDialog.style.cssText = `display: flex !important; left: ${left}px !important; top: ${top}px !important;`;
}

function hideFloatingDialog() {
  if (floatingDialog) floatingDialog.style.cssText = "display: none !important;";
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
