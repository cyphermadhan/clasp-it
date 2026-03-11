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
// Try chrome.sidePanel.open() explicitly (Chrome 116+).
// Fall back to a popup window for Arc and other browsers that don't support it.

chrome.action.onClicked.addListener(async (tab) => {
  consoleLogBuffer = [];
  networkRequestBuffer = [];

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    // sidePanel not supported or failed (e.g. Arc) — open as popup
    chrome.windows.create({
      url: chrome.runtime.getURL("sidepanel.html"),
      type: "popup",
      width: 380,
      height: 600,
    });
  }
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
