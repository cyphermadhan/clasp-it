/**
 * Authentication helpers.
 *
 * - API key generation and SHA-256 hashing
 * - requireApiKey middleware — validates X-API-Key against Postgres
 * - requireSession middleware — validates dashboard session token via Redis
 * - gatePayload — strips pro-gated context fields for free-tier users
 * - Plan feature definitions
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { pool } from './db.js';
import { redis } from './storage.js';

// ─── Plan definitions ─────────────────────────────────────────────────────────

export const PLANS = {
  free: {
    picksPerDay: 10,
    proToggles: false,
    historyLimit: 5,
  },
  pro: {
    picksPerDay: Infinity,
    proToggles: true,
    historyLimit: 50,
  },
};

// Context object keys and toggle keys that are pro-only
const PRO_CONTEXT_KEYS = ['screenshot', 'consoleLogs', 'networkRequests', 'reactProps', 'parentContext'];
const PRO_TOGGLE_KEYS = ['screenshot', 'console', 'network', 'react', 'parent'];

// ─── Key helpers ──────────────────────────────────────────────────────────────

/**
 * Hash a raw API key for storage (SHA-256, hex).
 * @param {string} raw
 * @returns {string}
 */
export function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Generate a new raw API key in format `cit_<32 hex chars>`.
 * Returns { raw, hash, prefix } — store hash + prefix only; show raw once.
 * @returns {{ raw: string, hash: string, prefix: string }}
 */
export function generateApiKey() {
  const raw = `cit_${crypto.randomBytes(16).toString('hex')}`;
  const hash = hashKey(raw);
  const prefix = raw.slice(0, 10); // "cit_" + first 6 hex chars
  return { raw, hash, prefix };
}

// ─── Session helpers ──────────────────────────────────────────────────────────

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/** In-memory session store for dev (no Redis). */
const sessionStore = new Map();

/**
 * Create a dashboard session token for a userId. Stores in Redis (or memory).
 * @param {string} userId
 * @returns {Promise<string>} session token
 */
export async function createSession(userId) {
  const token = uuidv4();
  if (redis) {
    await redis.set(`session:${token}`, userId, 'EX', SESSION_TTL);
  } else {
    sessionStore.set(token, { userId, expires: Date.now() + SESSION_TTL * 1000 });
  }
  return token;
}

/**
 * Resolve a session token to a userId, or null if invalid/expired.
 * @param {string|null} token
 * @returns {Promise<string|null>}
 */
export async function resolveSession(token) {
  if (!token) return null;
  if (redis) {
    return await redis.get(`session:${token}`);
  }
  const entry = sessionStore.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    sessionStore.delete(token);
    return null;
  }
  return entry.userId;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * requireApiKey — validates X-API-Key header against the api_keys table.
 *
 * Dev mode (no DATABASE_URL): uses the raw key value directly as userId
 * and grants full pro access so local dev still works without a database.
 *
 * Attaches req.userId (string) and req.userPlan (string) to the request.
 */
export async function requireApiKey(req, res, next) {
  // Accept both X-API-Key header and Authorization: Bearer <key>
  const auth = req.headers['authorization'];
  const raw = req.headers['x-api-key'] ||
    (auth?.startsWith('Bearer ') ? auth.slice(7) : null);
  if (!raw) {
    return res.status(401).json({ error: 'Missing X-API-Key or Authorization header' });
  }

  // Dev mode: no database, use key as userId with full access
  if (!pool) {
    req.userId = raw;
    req.userPlan = 'pro';
    return next();
  }

  try {
    const hash = hashKey(raw);
    const result = await pool.query(
      `SELECT ak.id, ak.user_id, u.plan
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = $1`,
      [hash],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const { id: keyId, user_id: userId, plan } = result.rows[0];

    // Update last_used_at without blocking the request
    pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [keyId]).catch(() => {});

    req.userId = userId;
    req.userPlan = plan;
    return next();
  } catch (err) {
    console.error('[auth] requireApiKey error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * requireSession — validates Authorization: Bearer <token> header.
 * Used by dashboard endpoints. Attaches req.userId and req.userPlan.
 */
export async function requireSession(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  // Dev mode
  if (!pool) {
    req.userId = token;
    req.userPlan = 'pro';
    return next();
  }

  try {
    const userId = await resolveSession(token);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const result = await pool.query('SELECT id, email, plan FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.userId = result.rows[0].id;
    req.userEmail = result.rows[0].email;
    req.userPlan = result.rows[0].plan;
    return next();
  } catch (err) {
    console.error('[auth] requireSession error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Feature gating ───────────────────────────────────────────────────────────

/**
 * Strip pro-gated context fields from a pick payload for free-tier users.
 * Modifies a shallow copy of the payload — does not mutate the original.
 * @param {object} payload
 * @param {string} plan
 * @returns {object}
 */
export function gatePayload(payload, plan) {
  const planDef = PLANS[plan] ?? PLANS.free;
  if (planDef.proToggles) return payload; // pro/team: nothing to strip

  const gated = { ...payload };

  // Strip pro fields from context object
  if (gated.context && typeof gated.context === 'object') {
    gated.context = { ...gated.context };
    for (const key of PRO_CONTEXT_KEYS) {
      delete gated.context[key];
    }
  }

  // Force pro toggle flags to false
  if (gated.toggles && typeof gated.toggles === 'object') {
    gated.toggles = { ...gated.toggles };
    for (const key of PRO_TOGGLE_KEYS) {
      gated.toggles[key] = false;
    }
  }

  return gated;
}
