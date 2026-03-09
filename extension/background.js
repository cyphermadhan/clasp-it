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

// ── Extension icon click → start picking ─────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Clear buffers for the new session
  consoleLogBuffer = [];
  networkRequestBuffer = [];

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START_PICKING" });
  } catch (err) {
    // Content script may not be ready (e.g. chrome:// pages). Log quietly.
    console.warn("[ClaspIt] Could not send START_PICKING:", err.message);
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
      const windowId = sender.tab?.windowId;
      chrome.tabs
        .captureVisibleTab(windowId, { format: "png" })
        .then((dataUrl) => sendResponse({ dataUrl }))
        .catch((err) => sendResponse({ error: err.message }));
      // Return true to signal async response
      return true;
    }

    default:
      break;
  }

  // Synchronous paths already called sendResponse; return false for them.
  return false;
});
