// Background service worker for Clasp It for Claude Code

const CONSOLE_BUFFER_SIZE = 50;
const NETWORK_BUFFER_SIZE = 30;

let consoleLogBuffer = [];
let networkRequestBuffer = [];

// ── Console log buffering ─────────────────────────────────────────────────────
// Content script intercepts console and forwards CONSOLE_LOG messages here.

// ── Network request buffering via webRequest ──────────────────────────────────
//
// Listens on <all_urls> so Pro users can capture network context for any page
// they pick from. We deliberately filter out our OWN server's traffic — those
// requests carry sensitive material (API key in Authorization headers, deviceId
// in legacy /auth/poll/:deviceId URLs) that has no business landing in a pick
// payload, getting echoed to the user's AI editor, and potentially their
// transcripts. The user's webpage traffic is the only thing of debugging
// interest here.

const SELF_HOST_RE = /^https?:\/\/(?:[^/]*\.)?claspit\.dev(?::\d+)?\//i;

if (chrome.webRequest) {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (SELF_HOST_RE.test(details.url)) return;
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

if (chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("[ClaspIt] sidePanel.setPanelBehavior:", err));
}

// Clear buffers whenever the icon is clicked (fires before panel opens).
chrome.action.onClicked.addListener(() => {
  consoleLogBuffer = [];
  networkRequestBuffer = [];
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
