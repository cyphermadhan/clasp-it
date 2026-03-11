// Background service worker for Clasp It for Claude Code

const CONSOLE_BUFFER_SIZE = 50;
const NETWORK_BUFFER_SIZE = 30;

let consoleLogBuffer = [];
let networkRequestBuffer = [];

// ── Console log buffering ─────────────────────────────────────────────────────
// Content script intercepts console and forwards CONSOLE_LOG messages here.

// ── Network request buffering via webRequest ──────────────────────────────────
if (chrome.webRequest) {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      networkRequestBuffer.push({
        url: details.url,
        method: details.method,
        status: details.statusCode,
        type: details.type,
        timestamp: Date.now(),
      });
      if (networkRequestBuffer.length > NETWORK_BUFFER_SIZE) {
        networkRequestBuffer.shift();
      }
    },
    { urls: ["<all_urls>"] }
  );
}

// ── Open side panel on icon click ─────────────────────────────────────────────
// In Chrome: setPanelBehavior intercepts the click and opens the side panel
// WITHOUT firing onClicked — so the popup below never runs in Chrome.
// In Arc/other browsers: setPanelBehavior is a no-op, onClicked fires normally,
// and we open a popup window as fallback.

if (chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
}

chrome.action.onClicked.addListener((_tab) => {
  consoleLogBuffer = [];
  networkRequestBuffer = [];

  // Only reaches here in browsers where sidePanel didn't intercept the click
  chrome.windows.create({
    url: chrome.runtime.getURL("sidepanel.html"),
    type: "popup",
    width: 400,
    height: 640,
  });
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // ── Content script forwards console log entries
    case "CONSOLE_LOG": {
      consoleLogBuffer.push({
        level: message.level || "log",
        args: message.args,
        timestamp: message.timestamp || Date.now(),
      });
      if (consoleLogBuffer.length > CONSOLE_BUFFER_SIZE) {
        consoleLogBuffer.shift();
      }
      sendResponse({ ok: true });
      break;
    }

    // ── Return buffered console logs
    case "GET_CONSOLE_LOGS": {
      sendResponse({ logs: consoleLogBuffer });
      break;
    }

    // ── Return buffered network requests
    case "GET_NETWORK_REQUESTS": {
      sendResponse({ requests: networkRequestBuffer });
      break;
    }

    // ── Screenshot capture
    case "CAPTURE_SCREENSHOT": {
      (async () => {
        try {
          let windowId = sender.tab?.windowId;
          if (!windowId) {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            windowId = activeTab?.windowId;
          }
          const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
          sendResponse({ dataUrl });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    default:
      break;
  }

  // Synchronous paths already called sendResponse; return false for them.
  return false;
});
