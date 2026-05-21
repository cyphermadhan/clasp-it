/**
 * Rate-limit factories.
 *
 * Two flavours:
 *   apiKeyLimiter(opts) — keyed by req.userId (set by requireApiKey).
 *                         Use AFTER the auth middleware.
 *   ipLimiter(opts)     — keyed by best-guess client IP. Use on
 *                         unauthenticated endpoints.
 *
 * Both use express-rate-limit's default in-memory store, which is fine for
 * the current single-instance Railway deploy. When we scale horizontally
 * we'll need a Redis-backed store; the factory is the right place to swap it.
 *
 * All limiters share the same envelope (429 + JSON body), so the extension
 * can detect rate-limited responses with one check.
 */

import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const FIFTEEN_MIN = 15 * 60 * 1000;

// Best-effort client IP behind Railway's proxy.
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimitedHandler(req, res) {
  res.status(429).json({
    error: 'Too many requests — slow down and try again in a minute',
  });
}

/**
 * Per-API-key limiter. Must be installed AFTER requireApiKey so req.userId
 * is set. If req.userId is missing (unauthenticated path slipped through),
 * fall back to IP so we still throttle.
 */
export function apiKeyLimiter({ windowMs = 60_000, max = 600 } = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.userId || ipKeyGenerator(clientIp(req)),
    handler: rateLimitedHandler,
  });
}

/**
 * Per-IP limiter for unauthenticated endpoints (signup, poll).
 * Tight by default — these are abuse vectors.
 */
export function ipLimiter({ windowMs = 60_000, max = 60 } = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    handler: rateLimitedHandler,
  });
}

// Re-export for callers that need to share the same windowMs constant.
export { FIFTEEN_MIN };
