var __defProp = Object.defineProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/utils/helpers.ts
function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16);
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function serializeError(error) {
  if (!error) {
    return { message: "Unknown error" };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...Object.keys(error).length > 0 && { ...error }
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}
function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
function isNode() {
  return typeof process !== "undefined" && process.versions != null && process.versions.node != null;
}
function detectEnvironment() {
  if (isNode() && process.env) {
    return process.env.NODE_ENV || "development";
  }
  if (isBrowser()) {
    const hostname = window.location?.hostname || "";
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "development";
    }
    if (hostname.includes("staging") || hostname.includes("dev")) {
      return "staging";
    }
    return "production";
  }
  return "unknown";
}
function sanitizeData(data, sensitiveKeys = ["password", "secret", "token", "apiKey", "api_key"]) {
  if (typeof data !== "object" || data === null) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item, sensitiveKeys));
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()));
    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeData(value, sensitiveKeys);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
function matchesPattern(url, patterns) {
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return url.includes(pattern);
    }
    return pattern.test(url);
  });
}
function deepMerge(target, source) {
  const output = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = output[key];
      if (sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue) && targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)) {
        output[key] = deepMerge(
          targetValue,
          sourceValue
        );
      } else {
        output[key] = sourceValue;
      }
    }
  }
  return output;
}
function getUserAgent() {
  if (isBrowser() && navigator?.userAgent) {
    return navigator.userAgent;
  }
  if (isNode()) {
    return `Node.js/${process.version}`;
  }
  return "Unknown";
}

// src/utils/context.ts
var SESSION_ID_KEY = "vibesignals_session_id";
var SESSION_START_KEY = "vibesignals_session_start";
var PAGE_VIEW_COUNT_KEY = "vibesignals_page_views";
var LAST_PAGE_URL_KEY = "vibesignals_last_page_url";
var SESSION_TIMEOUT = 30 * 60 * 1e3;
var cachedContext = null;
var contextCacheTime = 0;
var CONTEXT_CACHE_TTL = 60 * 1e3;
var lastCountedPageUrl = null;
function collectBrowserContext() {
  if (!isBrowser()) {
    return {};
  }
  const now = Date.now();
  if (cachedContext && now - contextCacheTime < CONTEXT_CACHE_TTL) {
    return {
      ...cachedContext,
      ...collectDynamicContext()
    };
  }
  const context = {
    // Device & Browser (from User Agent)
    ...parseUserAgent(),
    // Screen & Viewport
    ...collectScreenInfo(),
    // Hardware
    ...collectHardwareInfo(),
    // Locale & Timezone
    ...collectLocaleInfo(),
    // Network
    ...collectNetworkInfo(),
    // Page Context
    ...collectPageContext(),
    // UTM Parameters
    ...collectUTMParams(),
    // Session
    ...collectSessionInfo(),
    // Dynamic fields
    ...collectDynamicContext(),
    // Features
    ...collectFeatureFlags(),
    // Preferences
    ...collectUserPreferences(),
    // Performance
    ...collectPerformanceInfo()
  };
  cachedContext = context;
  contextCacheTime = now;
  return context;
}
function collectNodeContext() {
  if (!isNode()) {
    return {};
  }
  try {
    const os = __require("os");
    return {
      runtime: "node",
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu_cores: String(os.cpus()?.length || "unknown"),
      total_memory: String(Math.round(os.totalmem() / (1024 * 1024))),
      // MB
      free_memory: String(Math.round(os.freemem() / (1024 * 1024))),
      // MB
      uptime: String(Math.round(process.uptime())),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: process.env.LANG || process.env.LANGUAGE || "unknown"
    };
  } catch {
    return {
      runtime: "node",
      node_version: process.version,
      platform: process.platform,
      arch: process.arch
    };
  }
}
function parseUserAgent() {
  if (!isBrowser() || !navigator?.userAgent) {
    return {};
  }
  const ua = navigator.userAgent;
  const result = {};
  if (/Mobile|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    if (/iPad|Tablet/i.test(ua)) {
      result.device_type = "tablet";
    } else {
      result.device_type = "mobile";
    }
  } else {
    result.device_type = "desktop";
  }
  if (/Windows NT 10/i.test(ua)) {
    result.os_name = "Windows";
    result.os_version = "10";
  } else if (/Windows NT 6.3/i.test(ua)) {
    result.os_name = "Windows";
    result.os_version = "8.1";
  } else if (/Windows NT 6.2/i.test(ua)) {
    result.os_name = "Windows";
    result.os_version = "8";
  } else if (/Windows NT 6.1/i.test(ua)) {
    result.os_name = "Windows";
    result.os_version = "7";
  } else if (/Windows/i.test(ua)) {
    result.os_name = "Windows";
    result.os_version = "unknown";
  } else if (/Mac OS X (\d+[._]\d+)/i.test(ua)) {
    result.os_name = "macOS";
    const match = ua.match(/Mac OS X (\d+[._]\d+)/i);
    result.os_version = match ? match[1].replace("_", ".") : "unknown";
  } else if (/iPhone OS (\d+[._]\d+)/i.test(ua)) {
    result.os_name = "iOS";
    const match = ua.match(/iPhone OS (\d+[._]\d+)/i);
    result.os_version = match ? match[1].replace("_", ".") : "unknown";
  } else if (/iPad.*OS (\d+[._]\d+)/i.test(ua)) {
    result.os_name = "iPadOS";
    const match = ua.match(/OS (\d+[._]\d+)/i);
    result.os_version = match ? match[1].replace("_", ".") : "unknown";
  } else if (/Android (\d+\.?\d*)/i.test(ua)) {
    result.os_name = "Android";
    const match = ua.match(/Android (\d+\.?\d*)/i);
    result.os_version = match ? match[1] : "unknown";
  } else if (/Linux/i.test(ua)) {
    result.os_name = "Linux";
    result.os_version = "unknown";
  } else {
    result.os_name = "unknown";
    result.os_version = "unknown";
  }
  if (/Edg\/(\d+)/i.test(ua)) {
    result.browser_name = "Edge";
    const match = ua.match(/Edg\/(\d+)/i);
    result.browser_version = match ? match[1] : "unknown";
  } else if (/Chrome\/(\d+)/i.test(ua) && !/Chromium/i.test(ua)) {
    result.browser_name = "Chrome";
    const match = ua.match(/Chrome\/(\d+)/i);
    result.browser_version = match ? match[1] : "unknown";
  } else if (/Firefox\/(\d+)/i.test(ua)) {
    result.browser_name = "Firefox";
    const match = ua.match(/Firefox\/(\d+)/i);
    result.browser_version = match ? match[1] : "unknown";
  } else if (/Safari\/(\d+)/i.test(ua) && !/Chrome/i.test(ua)) {
    result.browser_name = "Safari";
    const match = ua.match(/Version\/(\d+)/i);
    result.browser_version = match ? match[1] : "unknown";
  } else if (/MSIE (\d+)/i.test(ua) || /Trident/i.test(ua)) {
    result.browser_name = "Internet Explorer";
    const match = ua.match(/MSIE (\d+)/i) || ua.match(/rv:(\d+)/i);
    result.browser_version = match ? match[1] : "unknown";
  } else {
    result.browser_name = "unknown";
    result.browser_version = "unknown";
  }
  return result;
}
function collectScreenInfo() {
  if (!isBrowser()) {
    return {};
  }
  const result = {};
  if (window.screen) {
    result.screen_width = String(window.screen.width);
    result.screen_height = String(window.screen.height);
    result.screen_color_depth = String(window.screen.colorDepth);
  }
  result.viewport_width = String(window.innerWidth);
  result.viewport_height = String(window.innerHeight);
  result.pixel_ratio = String(window.devicePixelRatio || 1);
  if (window.screen?.orientation?.type) {
    result.orientation = window.screen.orientation.type;
  } else if (window.matchMedia) {
    result.orientation = window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
  }
  return result;
}
function collectHardwareInfo() {
  if (!isBrowser()) {
    return {};
  }
  const result = {};
  if (navigator.hardwareConcurrency) {
    result.cpu_cores = String(navigator.hardwareConcurrency);
  }
  if (navigator.deviceMemory) {
    result.device_memory = String(
      navigator.deviceMemory
    );
  }
  const msMaxTouchPoints = navigator.msMaxTouchPoints;
  result.touch_capable = String(
    "ontouchstart" in window || navigator.maxTouchPoints > 0 || msMaxTouchPoints !== void 0 && msMaxTouchPoints > 0
  );
  return result;
}
function collectLocaleInfo() {
  const result = {};
  try {
    result.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    result.timezone = "unknown";
  }
  result.timezone_offset = String((/* @__PURE__ */ new Date()).getTimezoneOffset());
  if (isBrowser() && navigator) {
    result.language = navigator.language || "unknown";
    result.languages = navigator.languages?.join(",") || navigator.language || "unknown";
  }
  return result;
}
function collectNetworkInfo() {
  if (!isBrowser()) {
    return {};
  }
  const result = {};
  result.online_status = String(navigator.onLine);
  const connection = navigator.connection;
  if (connection) {
    result.connection_type = connection.type || "unknown";
    result.connection_effective_type = connection.effectiveType || "unknown";
    if (connection.downlink !== void 0) {
      result.connection_downlink = String(connection.downlink);
    }
    if (connection.rtt !== void 0) {
      result.connection_rtt = String(connection.rtt);
    }
  }
  return result;
}
function collectPageContext() {
  if (!isBrowser()) {
    return {};
  }
  const result = {};
  if (window.location) {
    result.page_url = window.location.href;
    result.page_path = window.location.pathname;
    result.page_hostname = window.location.hostname;
  }
  if (document) {
    result.page_title = document.title || "unknown";
    result.page_referrer = document.referrer || "direct";
  }
  return result;
}
function collectUTMParams() {
  if (!isBrowser() || !window.location?.search) {
    return {};
  }
  const result = {};
  const params = new URLSearchParams(window.location.search);
  const utmParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  utmParams.forEach((param) => {
    const value = params.get(param);
    if (value) {
      result[param] = value;
    }
  });
  return result;
}
function collectSessionInfo() {
  if (!isBrowser()) {
    return {};
  }
  const result = {};
  try {
    const storage = window.sessionStorage;
    const now = Date.now();
    const currentPageUrl = window.location.href;
    let sessionId = storage.getItem(SESSION_ID_KEY);
    let sessionStart = storage.getItem(SESSION_START_KEY);
    let pageViews = parseInt(storage.getItem(PAGE_VIEW_COUNT_KEY) || "0", 10);
    const storedLastPageUrl = storage.getItem(LAST_PAGE_URL_KEY);
    if (sessionStart) {
      const lastActivity = parseInt(sessionStart, 10);
      if (now - lastActivity > SESSION_TIMEOUT) {
        sessionId = null;
        sessionStart = null;
        pageViews = 0;
        lastCountedPageUrl = null;
      }
    }
    if (!sessionId) {
      sessionId = generateId();
      sessionStart = String(now);
      pageViews = 0;
      lastCountedPageUrl = null;
      storage.setItem(SESSION_ID_KEY, sessionId);
    }
    storage.setItem(SESSION_START_KEY, String(now));
    const isNewPage = currentPageUrl !== lastCountedPageUrl && currentPageUrl !== storedLastPageUrl;
    if (isNewPage) {
      pageViews++;
      lastCountedPageUrl = currentPageUrl;
      storage.setItem(PAGE_VIEW_COUNT_KEY, String(pageViews));
      storage.setItem(LAST_PAGE_URL_KEY, currentPageUrl);
    }
    result.session_id = sessionId;
    result.session_start = sessionStart || String(now);
    result.page_view_count = String(pageViews);
  } catch {
    const currentPageUrl = window.location.href;
    const isNewPage = currentPageUrl !== lastCountedPageUrl;
    if (isNewPage) {
      lastCountedPageUrl = currentPageUrl;
    }
    result.session_id = generateId();
    result.session_start = String(Date.now());
    result.page_view_count = isNewPage ? "1" : "0";
  }
  return result;
}
function collectDynamicContext() {
  if (!isBrowser()) {
    return {};
  }
  return {
    document_visible: String(document.visibilityState === "visible"),
    online_status: String(navigator.onLine)
  };
}
function collectFeatureFlags() {
  if (!isBrowser()) {
    return {};
  }
  const result = {};
  result.cookies_enabled = String(navigator.cookieEnabled);
  const dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  result.do_not_track = String(dnt === "1" || dnt === "yes");
  result.ad_blocker_detected = String(detectAdBlocker());
  return result;
}
function detectAdBlocker() {
  if (!isBrowser()) {
    return false;
  }
  try {
    const testAd = document.createElement("div");
    testAd.innerHTML = "&nbsp;";
    testAd.className = "adsbox ad-banner ad-placeholder";
    testAd.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;";
    document.body.appendChild(testAd);
    const isBlocked = testAd.offsetHeight === 0 || testAd.offsetWidth === 0 || testAd.clientHeight === 0;
    document.body.removeChild(testAd);
    return isBlocked;
  } catch {
    return false;
  }
}
function collectUserPreferences() {
  if (!isBrowser() || !window.matchMedia) {
    return {};
  }
  const result = {};
  result.prefers_dark_mode = String(
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  result.prefers_reduced_motion = String(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  return result;
}
function collectPerformanceInfo() {
  if (!isBrowser() || !window.performance) {
    return {};
  }
  const result = {};
  try {
    const timing = performance.timing || performance.timing;
    if (timing && timing.loadEventEnd > 0) {
      result.page_load_time = String(timing.loadEventEnd - timing.navigationStart);
      result.dom_ready_time = String(timing.domContentLoadedEventEnd - timing.navigationStart);
    } else {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0) {
        const nav = navEntries[0];
        if (nav.loadEventEnd > 0) {
          result.page_load_time = String(Math.round(nav.loadEventEnd));
          result.dom_ready_time = String(Math.round(nav.domContentLoadedEventEnd));
        }
      }
    }
  } catch {
  }
  return result;
}
function getSessionId() {
  if (!isBrowser()) {
    return generateId();
  }
  try {
    let sessionId = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = generateId();
      window.sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  } catch {
    return generateId();
  }
}
function collectContext() {
  if (isBrowser()) {
    const context = collectBrowserContext();
    return Object.entries(context).filter(([, value]) => value !== void 0 && value !== "" && value !== "unknown").reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }
  if (isNode()) {
    const context = collectNodeContext();
    return Object.entries(context).filter(([, value]) => value !== void 0 && value !== "" && value !== "unknown").reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }
  return {};
}

// src/core/mapper.ts
function mapEventToAPI(event, config) {
  const source = config.source || getDefaultSource();
  const userId = event.context.user?.id;
  const tags = convertTagsToArray(event.tags);
  const metadata = buildMetadata(event, config);
  const sessionId = extractSessionId(event) || metadata.session_id || getSessionId();
  const data = {
    ...event.data,
    sdk_event_id: event.id,
    sdk_event_type: event.type,
    environment: event.environment
  };
  const sanitizedData = config.privacy ? sanitizeData(data, config.privacy) : data;
  const apiEvent = {
    event_id: event.id,
    event_type: mapEventType(event.type),
    timestamp: event.timestamp,
    source,
    user_id: userId,
    session_id: sessionId,
    data: sanitizedData,
    version: config.release || "1.0",
    tags: tags.length > 0 ? tags.slice(0, 20) : void 0,
    // Max 20 tags
    metadata: Object.keys(metadata).length > 0 ? metadata : void 0
  };
  const userAgent = getUserAgent();
  if (userAgent && userAgent.length <= 500) {
    apiEvent.user_agent = userAgent;
  }
  const sourceIp = extractSourceIp();
  if (sourceIp) {
    apiEvent.source_ip = sourceIp;
  }
  return apiEvent;
}
function mapEventType(sdkType) {
  const typeMap = {
    "sdk.initialized": "sdk.init",
    "error": "error.exception",
    "console": "log.console",
    "http": "http.request",
    "performance": "performance.metric",
    "trace": "trace.span",
    "custom.event": "custom.event",
    "custom.metric": "custom.metric",
    "database": "database.query"
  };
  return typeMap[sdkType] || sdkType;
}
function convertTagsToArray(tags) {
  if (!tags || Object.keys(tags).length === 0) {
    return [];
  }
  return Object.entries(tags).map(([key, value]) => {
    if (value === true) {
      return key;
    }
    return `${key}:${value}`;
  }).filter((tag) => tag.length <= 100);
}
function buildMetadata(event, config) {
  const metadata = {};
  const environmentContext = collectContext();
  Object.assign(metadata, environmentContext);
  if (event.environment) {
    metadata.environment = event.environment;
  }
  if (config.release) {
    metadata.release = config.release;
  }
  Object.entries(event.context).forEach(([key, value]) => {
    if (key !== "user" && value !== null && value !== void 0) {
      metadata[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
  });
  const entries = Object.entries(metadata);
  if (entries.length > 50) {
    return Object.fromEntries(entries.slice(0, 50));
  }
  return metadata;
}
function extractSessionId(event) {
  if (event.context.sessionId) {
    return String(event.context.sessionId);
  }
  if (event.context.session_id) {
    return String(event.context.session_id);
  }
  if (event.data.sessionId) {
    return String(event.data.sessionId);
  }
  if (event.data.session_id) {
    return String(event.data.session_id);
  }
  return getSessionId();
}
function getDefaultSource() {
  if (typeof window !== "undefined") {
    if (typeof document !== "undefined" && document.title) {
      return `web-app:${document.title}`;
    }
    return "web-app";
  }
  if (typeof process !== "undefined") {
    return process.env.npm_package_name || "node-app";
  }
  return "8stack-sdk";
}
function extractSourceIp() {
  return void 0;
}
function validateAPIEvent(event) {
  const errors = [];
  if (!event.event_type || event.event_type.length < 1 || event.event_type.length > 100) {
    errors.push("event_type is required (1-100 chars)");
  }
  if (!event.timestamp) {
    errors.push("timestamp is required");
  } else {
    const date = new Date(event.timestamp);
    if (isNaN(date.getTime())) {
      errors.push("timestamp must be valid ISO8601 format");
    }
  }
  if (!event.source || event.source.length < 1 || event.source.length > 255) {
    errors.push("source is required (1-255 chars)");
  }
  if (!event.data || typeof event.data !== "object") {
    errors.push("data is required and must be an object");
  }
  if (event.source_ip && !isValidIPv4(event.source_ip)) {
    errors.push("source_ip must be valid IPv4");
  }
  if (event.user_agent && event.user_agent.length > 500) {
    errors.push("user_agent max 500 chars");
  }
  if (event.user_id && event.user_id.length > 255) {
    errors.push("user_id max 255 chars");
  }
  if (event.session_id && event.session_id.length > 255) {
    errors.push("session_id max 255 chars");
  }
  if (event.version && event.version.length > 50) {
    errors.push("version max 50 chars");
  }
  if (event.tags && event.tags.length > 20) {
    errors.push("tags max 20 items");
  }
  if (event.tags) {
    event.tags.forEach((tag, i) => {
      if (tag.length > 100) {
        errors.push(`tag at index ${i} exceeds 100 chars`);
      }
    });
  }
  if (event.metadata && Object.keys(event.metadata).length > 50) {
    errors.push("metadata max 50 key-value pairs");
  }
  return {
    valid: errors.length === 0,
    errors
  };
}
function isValidIPv4(ip) {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  if (!match) return false;
  return match.slice(1, 5).every((octet) => {
    const num = parseInt(octet, 10);
    return num >= 0 && num <= 255;
  });
}

// src/core/errors.ts
var APIError = class _APIError extends Error {
  constructor(message, statusCode, errorCode, details = {}) {
    super(message);
    this.name = "APIError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    Object.setPrototypeOf(this, _APIError.prototype);
  }
};
var ValidationError = class _ValidationError extends APIError {
  constructor(message, details = {}) {
    super(message, 400, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, _ValidationError.prototype);
  }
};
var UnauthorizedError = class _UnauthorizedError extends APIError {
  constructor(message = "Invalid or missing API key", details = {}) {
    super(message, 401, "UNAUTHORIZED", details);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, _UnauthorizedError.prototype);
  }
};
var RateLimitError = class _RateLimitError extends APIError {
  constructor(message, retryAfter = 60, details = {}) {
    super(message, 429, "RATE_LIMIT_EXCEEDED", { ...details, retry_after: retryAfter });
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, _RateLimitError.prototype);
  }
};
var BatchTooLargeError = class _BatchTooLargeError extends APIError {
  constructor(maxSize, received, details = {}) {
    super(
      `Batch size exceeds maximum allowed (${maxSize} events)`,
      400,
      "BATCH_TOO_LARGE",
      { ...details, max_batch_size: maxSize, received }
    );
    this.name = "BatchTooLargeError";
    this.maxSize = maxSize;
    this.received = received;
    Object.setPrototypeOf(this, _BatchTooLargeError.prototype);
  }
};
var ServiceUnavailableError = class _ServiceUnavailableError extends APIError {
  constructor(message = "Service temporarily unavailable", details = {}) {
    super(message, 503, "SERVICE_UNAVAILABLE", details);
    this.name = "ServiceUnavailableError";
    Object.setPrototypeOf(this, _ServiceUnavailableError.prototype);
  }
};
var DatabaseError = class _DatabaseError extends APIError {
  constructor(message = "Database connection error", details = {}) {
    super(message, 503, "DATABASE_ERROR", details);
    this.name = "DatabaseError";
    Object.setPrototypeOf(this, _DatabaseError.prototype);
  }
};
var NetworkError = class _NetworkError extends Error {
  constructor(message, originalError) {
    super(message);
    this.originalError = originalError;
    this.name = "NetworkError";
    Object.setPrototypeOf(this, _NetworkError.prototype);
  }
};
var MaxRetriesExceededError = class _MaxRetriesExceededError extends Error {
  constructor(message = "Maximum retry attempts exceeded", lastError) {
    super(message);
    this.lastError = lastError;
    this.name = "MaxRetriesExceededError";
    Object.setPrototypeOf(this, _MaxRetriesExceededError.prototype);
  }
};
function parseAPIError(statusCode, responseBody) {
  if (typeof responseBody === "object" && responseBody !== null) {
    const errorData = responseBody;
    const error = errorData.error;
    if (error) {
      const code = error.code || "UNKNOWN_ERROR";
      const message = error.message || "An error occurred";
      const details = error.details || {};
      switch (code) {
        case "VALIDATION_ERROR":
          return new ValidationError(message, details);
        case "UNAUTHORIZED":
          return new UnauthorizedError(message, details);
        case "RATE_LIMIT_EXCEEDED":
          return new RateLimitError(
            message,
            typeof details.retry_after === "number" ? details.retry_after : 60,
            details
          );
        case "BATCH_TOO_LARGE":
          return new BatchTooLargeError(
            typeof details.max_batch_size === "number" ? details.max_batch_size : 1e4,
            typeof details.received === "number" ? details.received : 0,
            details
          );
        case "SERVICE_UNAVAILABLE":
          return new ServiceUnavailableError(message, details);
        case "DATABASE_ERROR":
          return new DatabaseError(message, details);
        default:
          return new APIError(message, statusCode, code, details);
      }
    }
  }
  return new APIError(
    `HTTP ${statusCode} error`,
    statusCode,
    "UNKNOWN_ERROR",
    { responseBody }
  );
}
function isRetryableError(error) {
  if (error instanceof APIError) {
    return [429, 500, 503, 504, 408].includes(error.statusCode);
  }
  if (error instanceof NetworkError) {
    return true;
  }
  return false;
}

// src/core/transport.ts
var Transport = class {
  // 50 MB
  constructor(config) {
    this.MAX_BATCH_SIZE = 1e4;
    // API limit
    this.REQUEST_SIZE_LIMIT = 50 * 1024 * 1024;
    this.config = config;
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? 3,
      initialDelay: config.retry?.initialDelay ?? 1e3,
      maxDelay: config.retry?.maxDelay ?? 6e4,
      backoffMultiplier: config.retry?.backoffMultiplier ?? 2,
      jitter: config.retry?.jitter ?? true
    };
  }
  /**
   * Send events to the server (public API)
   */
  async send(events) {
    if (events.length === 0) return;
    const apiEvents = events.map((event) => mapEventToAPI(event, this.config));
    const invalidEvents = apiEvents.filter((event) => {
      const validation = validateAPIEvent(event);
      if (!validation.valid) {
        console.error(`[8Stack] Invalid event: ${validation.errors.join(", ")}`, event);
        return true;
      }
      return false;
    });
    const validEvents = apiEvents.filter((event) => {
      const validation = validateAPIEvent(event);
      return validation.valid;
    });
    if (validEvents.length === 0) {
      console.warn("[8Stack] No valid events to send");
      return;
    }
    try {
      const batches = this.splitIntoBatches(validEvents, this.MAX_BATCH_SIZE);
      await Promise.all(batches.map((batch) => this.sendBatchWithRetry(batch)));
      if (this.config.dev) {
        console.log(`[8Stack] Successfully sent ${validEvents.length} events in ${batches.length} batch(es)`);
        if (invalidEvents.length > 0) {
          console.warn(`[8Stack] Skipped ${invalidEvents.length} invalid events`);
        }
      }
    } catch (error) {
      console.error("[8Stack] Failed to send events after retries:", error);
      throw error;
    }
  }
  /**
   * Send a batch with retry logic
   */
  async sendBatchWithRetry(events) {
    let lastError;
    let delay = this.retryConfig.initialDelay;
    let attempt = 0;
    while (attempt <= this.retryConfig.maxRetries) {
      try {
        return await this.sendBatch(events);
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error)) {
          throw error;
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw new MaxRetriesExceededError(
            `Failed after ${this.retryConfig.maxRetries + 1} attempts`,
            lastError
          );
        }
        const jitter = this.retryConfig.jitter ? Math.random() * 0.1 * delay : 0;
        const actualDelay = Math.min(delay + jitter, this.retryConfig.maxDelay);
        if (this.config.dev) {
          console.log(`[8Stack] Retry attempt ${attempt + 1}/${this.retryConfig.maxRetries} after ${Math.round(actualDelay)}ms`);
        }
        await this.sleep(actualDelay);
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelay);
        attempt++;
      }
    }
    throw new MaxRetriesExceededError("Retry loop completed without success", lastError);
  }
  /**
   * Send a batch of events to the API
   */
  async sendBatch(events) {
    const endpoint = `${this.getBaseUrl()}/events/batch`;
    const timeout = this.config.timeout || 3e4;
    const batchRequest = {
      events
    };
    const payload = JSON.stringify(batchRequest);
    const payloadSize = new Blob([payload]).size;
    if (payloadSize > this.REQUEST_SIZE_LIMIT) {
      throw new ValidationError(
        `Request size ${payloadSize} exceeds limit ${this.REQUEST_SIZE_LIMIT}`,
        { payload_size: payloadSize, limit: this.REQUEST_SIZE_LIMIT }
      );
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.makeRequest(endpoint, payload, controller.signal);
      if (!response.ok) {
        const errorBody = await this.safeParseJSON(response);
        throw parseAPIError(response.status, errorBody);
      }
      const responseData = await response.json();
      if (responseData.failed > 0 && this.config.dev) {
        console.warn(
          `[8Stack] Batch partially failed: ${responseData.successful}/${responseData.total_events} succeeded`,
          responseData.errors
        );
      }
      return responseData;
    } catch (error) {
      if (error instanceof TypeError || error.name === "AbortError") {
        throw new NetworkError("Network request failed", error);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  /**
   * Make HTTP request (browser or Node.js)
   */
  async makeRequest(endpoint, payload, signal) {
    const headers = {
      "Content-Type": "application/json",
      "X-API-Key": this.config.apiKey,
      "User-Agent": this.getUserAgent()
    };
    const requestId = this.generateRequestId();
    if (requestId) {
      headers["X-Request-ID"] = requestId;
    }
    if (isBrowser()) {
      return fetch(endpoint, {
        method: "POST",
        headers,
        body: payload,
        signal
      });
    } else {
      if (typeof fetch === "undefined") {
        throw new NetworkError(
          "Fetch API not available. Please use Node.js 18+ or install a fetch polyfill."
        );
      }
      return fetch(endpoint, {
        method: "POST",
        headers,
        body: payload,
        signal
      });
    }
  }
  /**
   * Split events into batches
   */
  splitIntoBatches(events, maxSize) {
    const batches = [];
    for (let i = 0; i < events.length; i += maxSize) {
      batches.push(events.slice(i, i + maxSize));
    }
    return batches;
  }
  /**
   * Get base URL for API based on mode
   */
  getBaseUrl() {
    const baseEndpoint = this.config.endpoint || "http://localhost:8080";
    const endpoint = baseEndpoint.replace(/\/$/, "");
    return `${endpoint}/v1`;
  }
  /**
   * Get user agent string
   */
  getUserAgent() {
    const sdkVersion = "1.0.0";
    const sdkName = "@vibesignals/observe";
    if (isBrowser()) {
      return `${sdkName}/${sdkVersion} (Browser; ${navigator.userAgent})`;
    } else {
      const nodeVersion = typeof process !== "undefined" ? process.version : "unknown";
      return `${sdkName}/${sdkVersion} (Node.js ${nodeVersion})`;
    }
  }
  /**
   * Generate request ID for tracking
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Safely parse JSON response
   */
  async safeParseJSON(response) {
    try {
      return await response.json();
    } catch {
      const text = await response.text();
      return { error: { code: "PARSE_ERROR", message: text } };
    }
  }
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /**
   * Flush any pending operations (no-op in this implementation)
   * Kept for backward compatibility
   */
  async flush() {
    return Promise.resolve();
  }
};

// src/core/instrumentation.ts
var Instrumentation = class {
  constructor(config, trackCallback) {
    this.originalConsole = {};
    this.instrumentationActive = false;
    this.config = config;
    this.trackCallback = trackCallback;
  }
  /**
   * Set up all automatic instrumentation
   */
  setup() {
    if (this.instrumentationActive) return;
    if (this.config.captureConsole) {
      this.instrumentConsole();
    }
    if (this.config.captureErrors) {
      this.instrumentErrors();
    }
    if (this.config.captureHttp) {
      this.instrumentHttp();
    }
    if (this.config.capturePerformance && isBrowser()) {
      this.instrumentPerformance();
    }
    this.instrumentationActive = true;
  }
  /**
   * Clean up instrumentation
   */
  cleanup() {
    if (!this.instrumentationActive) return;
    if (Object.keys(this.originalConsole).length > 0) {
      Object.assign(console, this.originalConsole);
    }
    if (this.originalFetch && isBrowser()) {
      window.fetch = this.originalFetch;
    }
    this.instrumentationActive = false;
  }
  /**
   * Instrument console methods
   */
  instrumentConsole() {
    if (typeof console === "undefined") return;
    const levels = ["log", "warn", "error", "info", "debug"];
    levels.forEach((level) => {
      this.originalConsole[level] = console[level].bind(console);
      console[level] = (...args) => {
        this.originalConsole[level](...args);
        this.trackCallback("console", {
          level,
          message: args.map((arg) => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" "),
          args,
          timestamp: Date.now()
        });
      };
    });
  }
  /**
   * Instrument error handlers
   */
  instrumentErrors() {
    if (isBrowser()) {
      window.addEventListener("error", (event) => {
        this.trackCallback("error", {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: serializeError(event.error),
          timestamp: Date.now()
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        this.trackCallback("error", {
          type: "unhandledRejection",
          reason: serializeError(event.reason),
          promise: String(event.promise),
          timestamp: Date.now()
        });
      });
    } else if (isNode()) {
      process.on("uncaughtException", (error) => {
        this.trackCallback("error", {
          type: "uncaughtException",
          error: serializeError(error),
          timestamp: Date.now()
        });
      });
      process.on("unhandledRejection", (reason) => {
        this.trackCallback("error", {
          type: "unhandledRejection",
          reason: serializeError(reason),
          timestamp: Date.now()
        });
      });
    }
  }
  /**
   * Instrument HTTP requests
   */
  instrumentHttp() {
    if (isBrowser() && typeof window.fetch !== "undefined") {
      this.originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const startTime = Date.now();
        const url = typeof args[0] === "string" ? args[0] : args[0].url;
        const method = (args[1]?.method || "GET").toUpperCase();
        try {
          const response = await this.originalFetch(...args);
          const duration = Date.now() - startTime;
          this.trackCallback("http", {
            method,
            url,
            status: response.status,
            statusText: response.statusText,
            duration,
            timestamp: Date.now()
          });
          return response;
        } catch (error) {
          const duration = Date.now() - startTime;
          this.trackCallback("http", {
            method,
            url,
            error: serializeError(error),
            duration,
            timestamp: Date.now()
          });
          throw error;
        }
      };
    }
  }
  /**
   * Instrument performance metrics (Web Vitals)
   */
  instrumentPerformance() {
    if (!isBrowser()) return;
    window.addEventListener("load", () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType("navigation")[0];
        if (perfData) {
          this.trackCallback("performance", {
            type: "pageLoad",
            duration: perfData.loadEventEnd - perfData.fetchStart,
            domContentLoaded: perfData.domContentLoadedEventEnd - perfData.fetchStart,
            firstByte: perfData.responseStart - perfData.fetchStart,
            domInteractive: perfData.domInteractive - perfData.fetchStart,
            timestamp: Date.now()
          });
        }
      }, 0);
    });
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          this.trackCallback("performance", {
            type: "lcp",
            value: lastEntry.renderTime || lastEntry.loadTime || 0,
            timestamp: Date.now()
          });
        });
        observer.observe({ entryTypes: ["largest-contentful-paint"] });
      } catch (e) {
      }
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry) => {
            const fidEntry = entry;
            this.trackCallback("performance", {
              type: "fid",
              value: fidEntry.processingStart - fidEntry.startTime,
              timestamp: Date.now()
            });
          });
        });
        observer.observe({ entryTypes: ["first-input"] });
      } catch (e) {
      }
      try {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry) => {
            const layoutShift = entry;
            if (!layoutShift.hadRecentInput) {
              clsValue += layoutShift.value;
            }
          });
          this.trackCallback("performance", {
            type: "cls",
            value: clsValue,
            timestamp: Date.now()
          });
        });
        observer.observe({ entryTypes: ["layout-shift"] });
      } catch (e) {
      }
    }
  }
};

// src/core/sdk.ts
var ObserveSDK = class _ObserveSDK {
  constructor() {
    this.queue = [];
    this.context = {};
    this.flushTimer = null;
    this.initialized = false;
    this.transport = null;
    this.instrumentation = null;
    this.integrations = [];
    this.defaultConfig = {
      mode: "custom-events",
      // Default to custom events API
      endpoint: _ObserveSDK.getDefaultEndpoint(),
      // Production endpoint with env var override support
      environment: "production",
      enabled: true,
      dev: false,
      sampleRate: 1,
      batchSize: 1e3,
      // Optimal batch size for API (max 10,000)
      flushInterval: 5e3,
      // Flush every 5 seconds
      autoInstrument: true,
      captureConsole: true,
      captureErrors: true,
      capturePerformance: true,
      captureHttp: true,
      captureDatabase: false,
      maxBreadcrumbs: 100,
      maxBatchSize: 1e4,
      // API maximum
      timeout: 3e4,
      // 30 seconds for API calls
      offlineQueue: true,
      performanceThresholds: {
        slow: 1e3,
        critical: 3e3
      },
      retry: {
        maxRetries: 3,
        initialDelay: 1e3,
        maxDelay: 6e4,
        backoffMultiplier: 2,
        jitter: true
      }
    };
    this.config = { ...this.defaultConfig, apiKey: "" };
  }
  /**
   * Get default endpoint with environment variable override support
   * Priority: ENV VAR > Production Default
   */
  static getDefaultEndpoint() {
    if (typeof process !== "undefined" && process.env.OBSERVE_ENDPOINT) {
      return process.env.OBSERVE_ENDPOINT;
    }
    return "https://ingestion.vibesignals.ai";
  }
  /**
   * Initialize the SDK - THE ONLY REQUIRED CALL
   */
  init(apiKey, options = {}) {
    if (!apiKey) {
      console.warn("[8Stack] API key is required");
      return this;
    }
    this.config = deepMerge(
      { ...this.defaultConfig, apiKey },
      options
    );
    if (!options.environment) {
      this.config.environment = detectEnvironment();
    }
    this.initialized = true;
    if (!this.config.dev) {
      this.transport = new Transport(this.config);
    }
    if (this.config.autoInstrument) {
      this.instrumentation = new Instrumentation(this.config, this.track.bind(this));
      this.instrumentation.setup();
    }
    if (this.config.integrations) {
      this.setupIntegrations(this.config.integrations);
    }
    if (!this.config.dev) {
      this.startBatchFlush();
    }
    if (this.config.dev) {
      console.log("\u{1F50D} [Vibe-Signals] SDK initialized in DEV mode");
      console.log("   Environment:", this.config.environment);
      console.log("   Auto-instrument:", this.config.autoInstrument);
      console.log("   Sample rate:", this.config.sampleRate);
    }
    this.track("sdk.initialized", {
      version: "1.0.0",
      environment: this.config.environment,
      userAgent: getUserAgent(),
      config: {
        autoInstrument: this.config.autoInstrument,
        captureConsole: this.config.captureConsole,
        captureErrors: this.config.captureErrors,
        capturePerformance: this.config.capturePerformance,
        captureHttp: this.config.captureHttp
      }
    });
    return this;
  }
  /**
   * Track a custom event
   */
  event(name, properties = {}) {
    this.track("custom.event", {
      eventName: name,
      ...properties
    });
  }
  /**
   * Track a custom metric
   */
  metric(name, value, tags = {}) {
    this.track("custom.metric", {
      metricName: name,
      value,
      tags
    });
  }
  /**
   * Trace a function execution
   */
  async trace(name, fn, metadata = {}) {
    const startTime = Date.now();
    const spanId = generateId();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.track("trace", {
        spanId,
        name,
        duration,
        status: "success",
        ...metadata
      });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.track("trace", {
        spanId,
        name,
        duration,
        status: "error",
        error: serializeError(error),
        ...metadata
      });
      throw error;
    }
  }
  /**
   * Start a manual span for distributed tracing
   */
  startSpan(name, metadata = {}) {
    const spanId = generateId();
    const startTime = Date.now();
    const tags = { ...metadata };
    return {
      id: spanId,
      name,
      startTime,
      tags,
      setTag: (key, value) => {
        tags[key] = value;
      },
      finish: () => {
        const duration = Date.now() - startTime;
        this.track("trace", {
          spanId,
          name,
          duration,
          status: tags.error ? "error" : "success",
          ...tags
        });
      }
    };
  }
  /**
   * Set user context
   */
  setUser(user) {
    this.context.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      ...user
    };
  }
  /**
   * Set custom context
   */
  setContext(key, value) {
    this.context[key] = value;
  }
  /**
   * Clear context
   */
  clearContext() {
    this.context = {};
  }
  /**
   * Add tags to all events
   */
  setTags(tags) {
    this.config.tags = {
      ...this.config.tags,
      ...tags
    };
  }
  /**
   * Manually flush events
   */
  async flush() {
    if (this.queue.length > 0) {
      await this.sendEvents();
    }
    if (this.transport) {
      await this.transport.flush();
    }
  }
  /**
   * Disable the SDK
   */
  disable() {
    this.config.enabled = false;
    if (this.instrumentation) {
      this.instrumentation.cleanup();
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }
  /**
   * Enable the SDK
   */
  enable() {
    this.config.enabled = true;
    if (this.instrumentation) {
      this.instrumentation.setup();
    }
    if (!this.flushTimer && !this.config.dev) {
      this.startBatchFlush();
    }
  }
  /**
   * Internal: Track an event
   */
  track(type, data) {
    if (!this.initialized || !this.config.enabled) return;
    if (Math.random() > (this.config.sampleRate || 1)) return;
    if (type === "error" && this.config.ignoreErrors) {
      const message = String(data.message || data.error || "");
      if (matchesPattern(message, this.config.ignoreErrors)) {
        return;
      }
    }
    if (type === "http" && data.url) {
      const url = String(data.url);
      const sdkEndpoint = this.config.endpoint || "";
      if (sdkEndpoint && url.startsWith(sdkEndpoint)) {
        return;
      }
      if (this.config.ignoreUrls && matchesPattern(url, this.config.ignoreUrls)) {
        return;
      }
      if (this.config.allowUrls && !matchesPattern(url, this.config.allowUrls)) {
        return;
      }
    }
    const event = {
      id: generateId(),
      type,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      environment: this.config.environment || "unknown",
      context: { ...this.context },
      data,
      tags: this.config.tags
    };
    let processedEvent = event;
    if (this.config.beforeSend) {
      processedEvent = this.config.beforeSend(event);
      if (!processedEvent) return;
    }
    if (this.config.dev) {
      this.devLog(processedEvent);
      return;
    }
    this.queue.push(processedEvent);
    if (this.queue.length >= (this.config.batchSize || 100)) {
      this.sendEvents();
    }
  }
  /**
   * Set up integrations
   */
  setupIntegrations(integrations) {
    integrations.forEach((integration) => {
      try {
        integration.setup(this);
        this.integrations.push(integration);
      } catch (error) {
        console.error(`[8Stack] Failed to setup integration: ${integration.name}`, error);
      }
    });
  }
  /**
   * Start batch flushing
   */
  startBatchFlush() {
    this.flushTimer = setInterval(() => {
      this.sendEvents();
    }, this.config.flushInterval || 5e3);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        this.sendEvents();
      });
      window.addEventListener("pagehide", () => {
        this.sendEvents();
      });
    }
  }
  /**
   * Send events to server
   */
  async sendEvents() {
    if (this.queue.length === 0) return;
    const events = [...this.queue];
    this.queue = [];
    if (this.transport) {
      await this.transport.send(events);
    }
  }
  /**
   * Dev mode logging
   */
  devLog(event) {
    const icons = {
      console: "\u{1F4AC}",
      error: "\u274C",
      http: "\u{1F310}",
      performance: "\u26A1",
      trace: "\u{1F50D}",
      "custom.event": "\u{1F4CA}",
      "custom.metric": "\u{1F4C8}",
      database: "\u{1F5C4}\uFE0F",
      "sdk.initialized": "\u{1F680}"
    };
    const icon = icons[event.type] || "\u{1F4CB}";
    const typeLabel = event.type.toUpperCase();
    console.group(`${icon} [Vibe-Signals] ${typeLabel}`);
    console.log("Data:", event.data);
    if (Object.keys(event.context).length > 0) {
      console.log("Context:", event.context);
    }
    if (event.tags && Object.keys(event.tags).length > 0) {
      console.log("Tags:", event.tags);
    }
    console.log("Timestamp:", event.timestamp);
    console.groupEnd();
  }
};
var observe = new ObserveSDK();

// src/integrations/index.ts
var integrations_exports = {};
__export(integrations_exports, {
  Angular: () => Angular,
  AngularIntegration: () => AngularIntegration,
  Express: () => Express,
  ExpressIntegration: () => ExpressIntegration,
  NextJs: () => NextJs,
  NextJsIntegration: () => NextJsIntegration,
  React: () => React2,
  ReactIntegration: () => ReactIntegration,
  Vue: () => Vue,
  VueIntegration: () => VueIntegration,
  createAngularProviders: () => createAngularProviders,
  createVue2Mixin: () => createVue2Mixin
});

// src/integrations/express.ts
var ExpressIntegration = class {
  constructor(options = {}) {
    this.name = "Express";
    this.options = {
      captureRequestBody: false,
      captureResponseBody: false,
      captureHeaders: true,
      ...options
    };
  }
  setup(sdk) {
    this.sdk = sdk;
  }
  /**
   * Get Express middleware
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const requestData = {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        ip: req.ip,
        userAgent: req.get("user-agent")
      };
      if (this.options.captureHeaders) {
        requestData.headers = this.sanitizeHeaders(req.headers);
      }
      if (this.options.captureRequestBody && req.body) {
        requestData.body = req.body;
      }
      const originalSend = res.send;
      res.send = function(data) {
        res.send = originalSend;
        const duration = Date.now() - startTime;
        const responseData = {
          ...requestData,
          status: res.statusCode,
          duration
        };
        const self = this;
        if (self.options?.captureResponseBody) {
          responseData.response = data;
        }
        if (self.sdk) {
          self.sdk.track("http", responseData);
        }
        return originalSend.call(res, data);
      };
      res.on("error", (error) => {
        if (this.sdk) {
          this.sdk.track("error", {
            ...requestData,
            error: serializeError(error),
            context: "express-response"
          });
        }
      });
      next();
    };
  }
  /**
   * Get Express error handler middleware
   */
  errorHandler() {
    return (error, req, _res, next) => {
      if (this.sdk) {
        this.sdk.track("error", {
          method: req.method,
          url: req.url,
          path: req.path,
          error: serializeError(error),
          context: "express-error-handler"
        });
      }
      next(error);
    };
  }
  /**
   * Sanitize headers to remove sensitive data
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveHeaders = ["authorization", "cookie", "x-api-key"];
    for (const key of Object.keys(sanitized)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      }
    }
    return sanitized;
  }
};
function Express(options) {
  return new ExpressIntegration(options);
}

// src/integrations/nextjs.ts
import * as React from "react";
var NextJsIntegration = class {
  constructor(options = {}) {
    this.name = "NextJS";
    this.options = {
      captureApiRoutes: true,
      capturePages: true,
      captureServerComponents: true,
      ...options
    };
  }
  setup(sdk) {
    this.sdk = sdk;
    sdk.setContext("framework", {
      name: "Next.js",
      version: this.detectNextVersion()
    });
  }
  /**
   * Detect Next.js version
   */
  detectNextVersion() {
    try {
      if (typeof __require !== "undefined") {
        const next = __require("next/package.json");
        return next.version;
      }
    } catch {
    }
    return "unknown";
  }
  /**
   * Wrap Next.js API handler
   */
  wrapApiHandler(handler) {
    return (async (...args) => {
      const startTime = Date.now();
      const [req, res] = args;
      try {
        const result = await handler(...args);
        const duration = Date.now() - startTime;
        if (this.sdk && this.options.captureApiRoutes) {
          this.sdk.track("http", {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration,
            context: "nextjs-api-route"
          });
        }
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        if (this.sdk) {
          this.sdk.track("error", {
            method: req.method,
            url: req.url,
            duration,
            error,
            context: "nextjs-api-route"
          });
        }
        throw error;
      }
    });
  }
  /**
   * Wrap Next.js page component
   */
  wrapPageComponent(Component) {
    if (!this.options.capturePages) {
      return Component;
    }
    const WrappedComponent = (props) => {
      return React.createElement(Component, props);
    };
    WrappedComponent.displayName = `withObserve(${Component.displayName || Component.name || "Component"})`;
    return WrappedComponent;
  }
};
function NextJs(options) {
  return new NextJsIntegration(options);
}

// src/integrations/react.ts
var ReactIntegration = class {
  constructor(options = {}) {
    this.name = "React";
    this.options = {
      showErrorDialog: false,
      captureComponentStack: true,
      ...options
    };
  }
  setup(sdk) {
    this.sdk = sdk;
    sdk.setContext("framework", {
      name: "React",
      version: this.detectReactVersion()
    });
  }
  /**
   * Detect React version
   */
  detectReactVersion() {
    try {
      if (typeof __require !== "undefined") {
        const React3 = __require("react");
        return React3.version;
      }
    } catch {
    }
    return "unknown";
  }
  /**
   * Create Error Boundary component
   */
  createErrorBoundary() {
    const sdk = this.sdk;
    const options = this.options;
    return class ErrorBoundary extends __require("react").Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, errorInfo) {
        if (sdk) {
          sdk.track("error", {
            error: serializeError(error),
            componentStack: options.captureComponentStack ? errorInfo.componentStack : void 0,
            context: "react-error-boundary"
          });
        }
      }
      render() {
        if (this.state.hasError) {
          if (this.props.fallback) {
            return this.props.fallback;
          }
          if (options.showErrorDialog) {
            return __require("react").createElement("div", {
              style: {
                padding: "20px",
                backgroundColor: "#fee",
                border: "1px solid #fcc",
                borderRadius: "4px"
              },
              children: [
                __require("react").createElement("h2", { key: "title" }, "Something went wrong"),
                __require("react").createElement("p", { key: "message" }, this.state.error?.message)
              ]
            });
          }
          return null;
        }
        return this.props.children;
      }
    };
  }
  /**
   * HOC to wrap components with error tracking
   */
  withObserve(Component) {
    const sdk = this.sdk;
    const WrappedComponent = (props) => {
      const React3 = __require("react");
      React3.useEffect(() => {
        const componentName = Component.displayName || Component.name || "Component";
        sdk?.event("component.mounted", {
          component: componentName
        });
        return () => {
          sdk?.event("component.unmounted", {
            component: componentName
          });
        };
      }, []);
      return React3.createElement(Component, props);
    };
    WrappedComponent.displayName = `withObserve(${Component.displayName || Component.name || "Component"})`;
    return WrappedComponent;
  }
  /**
   * Hook for tracking events in functional components
   */
  useObserve() {
    const sdk = this.sdk;
    return {
      trackEvent: (name, properties) => {
        sdk?.event(name, properties);
      },
      trackMetric: (name, value, tags) => {
        sdk?.metric(name, value, tags);
      },
      trackError: (error) => {
        sdk?.track("error", {
          error: serializeError(error),
          context: "react-hook"
        });
      }
    };
  }
};
function React2(options) {
  return new ReactIntegration(options);
}

// src/integrations/vue.ts
var VueIntegration = class {
  constructor(options = {}) {
    this.name = "Vue";
    this.options = {
      trackComponents: true,
      trackRouterNavigation: true,
      captureComponentProps: false,
      ...options
    };
  }
  setup(sdk) {
    this.sdk = sdk;
    sdk.setContext("framework", {
      name: "Vue",
      version: this.detectVueVersion()
    });
  }
  /**
   * Detect Vue version
   */
  detectVueVersion() {
    try {
      if (typeof __require !== "undefined") {
        const Vue2 = __require("vue");
        return Vue2.version || "unknown";
      }
    } catch {
    }
    return "unknown";
  }
  /**
   * Install Vue plugin
   */
  install(app, options) {
    const sdk = this.sdk;
    const integrationOptions = this.options;
    app.config.errorHandler = (err, instance, info) => {
      if (sdk) {
        sdk.track("error", {
          error: serializeError(err),
          component: instance?.$options?.name || instance?.$options?.__name || "Unknown",
          errorInfo: info,
          context: "vue-error-handler"
        });
      }
      if (process.env.NODE_ENV === "development") {
        console.error(err);
      }
    };
    if (process.env.NODE_ENV === "development") {
      app.config.warnHandler = (msg, instance, trace) => {
        if (sdk) {
          sdk.track("console", {
            level: "warn",
            message: msg,
            component: instance?.$options?.name || instance?.$options?.__name || "Unknown",
            trace
          });
        }
      };
    }
    if (integrationOptions.trackComponents) {
      app.mixin({
        mounted() {
          const componentName = this.$options?.name || this.$options?.__name || "AnonymousComponent";
          if (sdk) {
            sdk.event("component.mounted", {
              component: componentName,
              ...integrationOptions.captureComponentProps && this.$props ? { props: this.$props } : {}
            });
          }
        },
        unmounted() {
          const componentName = this.$options?.name || this.$options?.__name || "AnonymousComponent";
          if (sdk) {
            sdk.event("component.unmounted", {
              component: componentName
            });
          }
        }
      });
    }
    if (integrationOptions.trackRouterNavigation && options?.router) {
      const router = options.router;
      router.beforeEach((to, from, next) => {
        if (sdk) {
          sdk.event("navigation.start", {
            to: to.path,
            from: from.path,
            routeName: to.name
          });
        }
        next();
      });
      router.afterEach((to, from) => {
        if (sdk) {
          sdk.event("navigation.complete", {
            to: to.path,
            from: from.path,
            routeName: to.name
          });
        }
      });
      router.onError((error) => {
        if (sdk) {
          sdk.track("error", {
            error: serializeError(error),
            context: "vue-router"
          });
        }
      });
    }
  }
  /**
   * Create a Vue composable for use in components
   */
  createComposable() {
    const sdk = this.sdk;
    return function useObserve() {
      return {
        trackEvent: (name, properties) => {
          sdk?.event(name, properties);
        },
        trackMetric: (name, value, tags) => {
          sdk?.metric(name, value, tags);
        },
        trackError: (error) => {
          sdk?.track("error", {
            error: serializeError(error),
            context: "vue-composable"
          });
        },
        trace: async (name, fn, metadata) => {
          return sdk?.trace(name, fn, metadata);
        }
      };
    };
  }
  /**
   * Track async component errors
   */
  trackAsyncComponentError(error, component) {
    if (this.sdk) {
      this.sdk.track("error", {
        error: serializeError(error),
        component,
        context: "vue-async-component"
      });
    }
  }
};
function Vue(options) {
  return new VueIntegration(options);
}
function createVue2Mixin(sdk, options = {}) {
  return {
    errorCaptured(err, vm, info) {
      if (sdk) {
        sdk.track("error", {
          error: serializeError(err),
          component: vm.$options?.name || "Unknown",
          errorInfo: info,
          context: "vue2-error-handler"
        });
      }
      return false;
    },
    mounted() {
      if (options.trackComponents && sdk) {
        const componentName = this.$options?.name || "AnonymousComponent";
        sdk.event("component.mounted", {
          component: componentName,
          ...options.captureComponentProps && this.$props ? { props: this.$props } : {}
        });
      }
    },
    beforeDestroy() {
      if (options.trackComponents && sdk) {
        const componentName = this.$options?.name || "AnonymousComponent";
        sdk.event("component.unmounted", {
          component: componentName
        });
      }
    }
  };
}

// src/integrations/angular.ts
var AngularIntegration = class {
  constructor(options = {}) {
    this.name = "Angular";
    this.options = {
      captureHttpRequests: true,
      captureRouterEvents: true,
      captureFormErrors: true,
      ...options
    };
  }
  setup(sdk) {
    this.sdk = sdk;
    sdk.setContext("framework", {
      name: "Angular",
      version: this.detectAngularVersion()
    });
  }
  /**
   * Detect Angular version
   */
  detectAngularVersion() {
    try {
      if (typeof __require !== "undefined") {
        const ng = __require("@angular/core");
        return ng.VERSION?.full || "unknown";
      }
    } catch {
    }
    return "unknown";
  }
  /**
   * Create Angular ErrorHandler
   *
   * Usage in app.module.ts:
   * ```typescript
   * import { ErrorHandler } from '@angular/core';
   *
   * @NgModule({
   *   providers: [
   *     { provide: ErrorHandler, useClass: ObserveErrorHandler }
   *   ]
   * })
   * ```
   */
  createErrorHandler() {
    const sdk = this.sdk;
    return class ObserveErrorHandler {
      handleError(error) {
        if (sdk) {
          sdk.track("error", {
            error: serializeError(error),
            context: "angular-error-handler"
          });
        }
        if (!sdk || sdk.config?.dev) {
          console.error("Error caught by ObserveErrorHandler:", error);
        }
      }
    };
  }
  /**
   * Create HTTP Interceptor for tracking HTTP requests
   *
   * Usage in app.module.ts:
   * ```typescript
   * import { HTTP_INTERCEPTORS } from '@angular/common/http';
   *
   * @NgModule({
   *   providers: [
   *     { provide: HTTP_INTERCEPTORS, useClass: ObserveHttpInterceptor, multi: true }
   *   ]
   * })
   * ```
   */
  createHttpInterceptor() {
    const sdk = this.sdk;
    const tapOperator = (callbacks) => {
      return (source) => {
        return {
          subscribe: (observer) => {
            return source.subscribe({
              next: (value) => {
                callbacks.next?.(value);
                observer.next?.(value);
              },
              error: (error) => {
                callbacks.error?.(error);
                observer.error?.(error);
              },
              complete: () => {
                callbacks.complete?.();
                observer.complete?.();
              }
            });
          }
        };
      };
    };
    return class ObserveHttpInterceptor {
      intercept(req, next) {
        const startTime = Date.now();
        return next.handle(req).pipe(
          // Use RxJS operators
          tapOperator({
            next: (event) => {
              if (event.type === 4) {
                const duration = Date.now() - startTime;
                if (sdk) {
                  sdk.track("http", {
                    method: req.method,
                    url: req.url,
                    status: event.status,
                    duration,
                    context: "angular-http-interceptor"
                  });
                }
              }
            },
            error: (error) => {
              const duration = Date.now() - startTime;
              if (sdk) {
                sdk.track("http", {
                  method: req.method,
                  url: req.url,
                  error: serializeError(error),
                  status: error.status,
                  duration,
                  context: "angular-http-interceptor"
                });
              }
            }
          })
        );
      }
    };
  }
  /**
   * Create Router Event Tracker
   *
   * Usage in app.component.ts:
   * ```typescript
   * constructor(private router: Router, private observeTracker: ObserveRouterTracker) {
   *   this.observeTracker.trackRouterEvents(router);
   * }
   * ```
   */
  createRouterTracker() {
    const sdk = this.sdk;
    return class ObserveRouterTracker {
      trackRouterEvents(router) {
        router.events.subscribe((event) => {
          if (event.constructor.name === "NavigationStart") {
            if (sdk) {
              sdk.event("navigation.start", {
                url: event.url,
                navigationTrigger: event.navigationTrigger
              });
            }
          }
          if (event.constructor.name === "NavigationEnd") {
            if (sdk) {
              sdk.event("navigation.complete", {
                url: event.url,
                urlAfterRedirects: event.urlAfterRedirects
              });
            }
          }
          if (event.constructor.name === "NavigationError") {
            if (sdk) {
              sdk.track("error", {
                error: serializeError(event.error),
                url: event.url,
                context: "angular-router-error"
              });
            }
          }
        });
      }
    };
  }
  /**
   * Create a service for manual tracking
   *
   * Usage:
   * ```typescript
   * @Injectable({ providedIn: 'root' })
   * export class ObserveService extends ObserveAngularService {}
   *
   * // In components:
   * constructor(private observe: ObserveService) {}
   *
   * someMethod() {
   *   this.observe.trackEvent('button_clicked', { button: 'submit' });
   * }
   * ```
   */
  createService() {
    const sdk = this.sdk;
    return class ObserveAngularService {
      trackEvent(name, properties) {
        sdk?.event(name, properties);
      }
      trackMetric(name, value, tags) {
        sdk?.metric(name, value, tags);
      }
      trackError(error) {
        sdk?.track("error", {
          error: serializeError(error),
          context: "angular-service"
        });
      }
      async trace(name, fn, metadata) {
        return sdk?.trace(name, fn, metadata);
      }
      setUser(user) {
        sdk?.setUser(user);
      }
      setContext(key, value) {
        sdk?.setContext(key, value);
      }
    };
  }
  /**
   * Create form validation error tracker
   */
  trackFormErrors(form, formName) {
    if (!this.options.captureFormErrors || !this.sdk) return;
    const errors = this.getFormErrors(form);
    if (Object.keys(errors).length > 0) {
      this.sdk.event("form.validation_error", {
        form: formName,
        errors
      });
    }
  }
  /**
   * Get all form validation errors
   */
  getFormErrors(form) {
    const errors = {};
    if (form.errors) {
      errors._form = form.errors;
    }
    Object.keys(form.controls || {}).forEach((key) => {
      const control = form.controls[key];
      if (control.errors) {
        errors[key] = control.errors;
      }
    });
    return errors;
  }
};
function Angular(options) {
  return new AngularIntegration(options);
}
function createAngularProviders(integration) {
  return {
    ErrorHandler: integration.createErrorHandler(),
    HttpInterceptor: integration.createHttpInterceptor(),
    RouterTracker: integration.createRouterTracker(),
    ObserveService: integration.createService()
  };
}
export {
  APIError,
  BatchTooLargeError,
  DatabaseError,
  MaxRetriesExceededError,
  NetworkError,
  ObserveSDK,
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  collectBrowserContext,
  collectContext,
  collectNodeContext,
  detectEnvironment,
  generateId,
  getSessionId,
  integrations_exports as integrations,
  isBrowser,
  isNode,
  observe,
  serializeError
};
//# sourceMappingURL=index.mjs.map