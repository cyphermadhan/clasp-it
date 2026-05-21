/**
 * Storage helpers — Redis-backed with in-memory fallback for local dev.
 *
 * Redis key layout:
 *   picks:<userId>  →  Redis List, index 0 = most recent, capped at 10
 */

import { createRequire } from 'module';
import { pool } from './db.js';

// ─── Redis client (optional) ─────────────────────────────────────────────────

let redis = null;

if (process.env.REDIS_URL) {
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    redis.on('error', (err) => {
      console.error('[storage] Redis error:', err.message);
    });

    await redis.connect();
    console.log('[storage] Connected to Redis');
  } catch (err) {
    console.warn('[storage] Failed to connect to Redis, falling back to in-memory store:', err.message);
    redis = null;
  }
} else {
  console.log('[storage] REDIS_URL not set — using in-memory store (not suitable for production)');
}

// ─── In-memory fallback ───────────────────────────────────────────────────────

/** @type {Map<string, string[]>} */
const memStore = new Map();

const MAX_PICKS = 10;
const TTL_SECONDS = 24 * 60 * 60; // 24 hours

function memKey(userId) {
  return `picks:${userId}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serialize(pick) {
  return JSON.stringify(pick);
}

function deserialize(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Push a pick to the front of the user's list, trim to last 10, set TTL 24h.
 * @param {string} userId
 * @param {object} pick
 */
export async function storePick(userId, pick) {
  const key = memKey(userId);
  const value = serialize(pick);

  if (redis) {
    // LPUSH → newest at index 0; LTRIM keeps indices 0..(MAX_PICKS-1)
    await redis.lpush(key, value);
    await redis.ltrim(key, 0, MAX_PICKS - 1);
    await redis.expire(key, TTL_SECONDS);
  } else {
    const list = memStore.get(key) ?? [];
    list.unshift(value);
    if (list.length > MAX_PICKS) list.length = MAX_PICKS;
    memStore.set(key, list);
  }
}

/**
 * Return the most recent pick (index 0) or null.
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getLatestPick(userId) {
  const key = memKey(userId);

  if (redis) {
    const raw = await redis.lindex(key, 0);
    return deserialize(raw);
  } else {
    const list = memStore.get(key);
    return list?.length ? deserialize(list[0]) : null;
  }
}

/**
 * Find a pick by its `id` field across the stored list.
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getPickById(userId, id) {
  const picks = await listRecentPicks(userId);
  return picks.find((p) => p.id === id) ?? null;
}

/**
 * Return all stored picks for the user (newest first).
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function listRecentPicks(userId, limit = 10) {
  const key = memKey(userId);

  if (redis) {
    const raws = await redis.lrange(key, 0, limit - 1);
    return raws.map(deserialize).filter(Boolean);
  } else {
    const list = memStore.get(key) ?? [];
    return list.slice(0, limit).map(deserialize).filter(Boolean);
  }
}

/**
 * Delete the entire pick list for a user.
 * @param {string} userId
 */
export async function clearPicks(userId) {
  const key = memKey(userId);

  if (redis) {
    await redis.del(key);
  } else {
    memStore.delete(key);
  }
}

/**
 * Remove a single pick from the user's list (by pickId).
 * Returns the removed pick (so callers can purge its attachments) or null.
 * @param {string} userId
 * @param {string} pickId
 * @returns {Promise<object|null>}
 */
export async function removePickFromList(userId, pickId) {
  const key = memKey(userId);

  if (redis) {
    const raws = await redis.lrange(key, 0, -1);
    for (const raw of raws) {
      const pick = deserialize(raw);
      if (pick?.id === pickId) {
        await redis.lrem(key, 1, raw);
        return pick;
      }
    }
    return null;
  }

  const list = memStore.get(key) ?? [];
  for (let i = 0; i < list.length; i++) {
    const pick = deserialize(list[i]);
    if (pick?.id === pickId) {
      list.splice(i, 1);
      memStore.set(key, list);
      return pick;
    }
  }
  return null;
}

// ─── Pick status ──────────────────────────────────────────────────────────────

/**
 * Update the `status` field of a specific pick in the user's list.
 * @param {string} userId
 * @param {string} pickId
 * @param {string} status  'not_started' | 'in_progress' | 'completed'
 * @returns {Promise<boolean>} true if found and updated
 */
export async function updatePickStatus(userId, pickId, status) {
  const key = memKey(userId);

  if (redis) {
    const raws = await redis.lrange(key, 0, -1);
    for (let i = 0; i < raws.length; i++) {
      const pick = deserialize(raws[i]);
      if (pick?.id === pickId) {
        pick.status = status;
        await redis.lset(key, i, serialize(pick));
        return true;
      }
    }
  } else {
    const list = memStore.get(key) ?? [];
    for (let i = 0; i < list.length; i++) {
      const pick = deserialize(list[i]);
      if (pick?.id === pickId) {
        pick.status = status;
        list[i] = serialize(pick);
        memStore.set(key, list);
        return true;
      }
    }
  }
  return false;
}

/**
 * Return a map of pickId → status for the given ids.
 * @param {string} userId
 * @param {string[]} ids
 * @returns {Promise<Record<string, string>>}
 */
export async function getPickStatuses(userId, ids) {
  const picks = await listRecentPicks(userId, 20);
  const result = {};
  for (const pick of picks) {
    if (ids.includes(pick.id)) {
      result[pick.id] = pick.status ?? 'not_started';
    }
  }
  return result;
}

// ─── Pick-level mutations (prompt + attachments) ──────────────────────────────
//
// Each mutator walks the user's pick list, finds the matching pick, applies a
// transform, and writes it back. Returns the mutated pick or null.

async function mutatePick(userId, pickId, transform) {
  const key = memKey(userId);

  if (redis) {
    const raws = await redis.lrange(key, 0, -1);
    for (let i = 0; i < raws.length; i++) {
      const pick = deserialize(raws[i]);
      if (pick?.id === pickId) {
        const next = transform(pick);
        if (!next) return null;
        await redis.lset(key, i, serialize(next));
        return next;
      }
    }
    return null;
  }

  const list = memStore.get(key) ?? [];
  for (let i = 0; i < list.length; i++) {
    const pick = deserialize(list[i]);
    if (pick?.id === pickId) {
      const next = transform(pick);
      if (!next) return null;
      list[i] = serialize(next);
      memStore.set(key, list);
      return next;
    }
  }
  return null;
}

/**
 * Update the prompt text on a pick. Returns the updated pick or null.
 * @param {string} userId
 * @param {string} pickId
 * @param {string} prompt
 */
export async function updatePickPrompt(userId, pickId, prompt) {
  return mutatePick(userId, pickId, (pick) => ({ ...pick, prompt }));
}

/**
 * Append an attachment record to a pick's attachments list.
 * Returns the updated pick or null.
 * @param {string} userId
 * @param {string} pickId
 * @param {object} attachment  { id, filename, mimeType, sizeBytes, r2Key }
 */
export async function addAttachmentToPick(userId, pickId, attachment) {
  return mutatePick(userId, pickId, (pick) => {
    const attachments = Array.isArray(pick.attachments) ? [...pick.attachments] : [];
    attachments.push(attachment);
    return { ...pick, attachments };
  });
}

/**
 * Remove an attachment by attachmentId from a pick's attachments list.
 * Returns the updated pick or null.
 * @param {string} userId
 * @param {string} pickId
 * @param {string} attachmentId
 */
export async function removeAttachmentFromPick(userId, pickId, attachmentId) {
  return mutatePick(userId, pickId, (pick) => {
    const attachments = (pick.attachments ?? []).filter((a) => a.id !== attachmentId);
    return { ...pick, attachments };
  });
}

/**
 * Return the attachments array for a pick (empty array if none).
 * @param {string} userId
 * @param {string} pickId
 * @returns {Promise<object[]>}
 */
export async function getAttachmentsForPick(userId, pickId) {
  const pick = await getPickById(userId, pickId);
  return pick?.attachments ?? [];
}

// ─── Device verification store (for magic link polling) ───────────────────────

/** In-memory fallback for device verifications. */
const deviceVerifyStore = new Map();
const DEVICE_VERIFY_TTL = 15 * 60; // 15 minutes in seconds

/**
 * Store a verified API key keyed by deviceId (used once, then cleared).
 */
export async function storeDeviceVerification(deviceId, payload) {
  const value = serialize(payload);
  if (redis) {
    await redis.set(`device:${deviceId}`, value, 'EX', DEVICE_VERIFY_TTL);
  } else {
    deviceVerifyStore.set(deviceId, { value, expires: Date.now() + DEVICE_VERIFY_TTL * 1000 });
  }
}

/**
 * Retrieve a device verification WITHOUT consuming it. Used by the legacy
 * GET /auth/poll/:deviceId endpoint, which polls repeatedly during the
 * verify window.
 * @returns {Promise<object|null>}
 */
export async function claimDeviceVerification(deviceId) {
  const redisKey = `device:${deviceId}`;
  if (redis) {
    const value = await redis.get(redisKey);
    if (!value) return null;
    // Don't delete — let the TTL expire naturally so multiple polls all succeed
    return deserialize(value);
  } else {
    const entry = deviceVerifyStore.get(deviceId);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      deviceVerifyStore.delete(deviceId);
      return null;
    }
    // Don't delete — let TTL handle cleanup
    return deserialize(entry.value);
  }
}

/**
 * Atomically retrieve AND delete a device verification record. One-shot —
 * subsequent calls for the same deviceId return null even if the TTL hasn't
 * elapsed. Used by the new POST /auth/poll endpoint to close the replay
 * window the audit flagged. Recovery (e.g. extension fails to save the
 * key after a successful poll) flows through the magic_links + pending_key
 * fallback path in routes/auth.js.
 *
 * Note: the magic_links and pending_key entries are NOT consumed here; only
 * the deviceId binding is.
 *
 * @returns {Promise<object|null>}
 */
export async function consumeDeviceVerification(deviceId) {
  const redisKey = `device:${deviceId}`;
  if (redis) {
    // GETDEL is a single round-trip atomic op (Redis 6.2+; Upstash supports it)
    const value = await redis.getdel(redisKey);
    if (!value) return null;
    return deserialize(value);
  }
  const entry = deviceVerifyStore.get(deviceId);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    deviceVerifyStore.delete(deviceId);
    return null;
  }
  // Single-process, no race possible
  deviceVerifyStore.delete(deviceId);
  return deserialize(entry.value);
}

// ─── Pending API key cache (keyed by userId, 15-min TTL) ─────────────────────
// Stored alongside the device verification so the poll fallback can retrieve
// the same raw key without creating a new DB entry on every Redis miss.

const pendingKeyStore = new Map();

/**
 * Cache the raw API key data for a user during the magic link window.
 * @param {string} userId
 * @param {{ apiKey: string, plan: string, email: string }} data
 */
export async function storePendingApiKey(userId, data) {
  const value = serialize(data);
  if (redis) {
    await redis.set(`pending_key:${userId}`, value, 'EX', DEVICE_VERIFY_TTL);
  } else {
    pendingKeyStore.set(userId, { value, expires: Date.now() + DEVICE_VERIFY_TTL * 1000 });
  }
}

/**
 * Retrieve (but do not delete) the cached raw API key for a user.
 * Returns null if not found or expired.
 * @param {string} userId
 * @returns {Promise<{ apiKey: string, plan: string, email: string } | null>}
 */
export async function getPendingApiKey(userId) {
  if (redis) {
    const value = await redis.get(`pending_key:${userId}`);
    return deserialize(value);
  }
  const entry = pendingKeyStore.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    pendingKeyStore.delete(userId);
    return null;
  }
  return deserialize(entry.value);
}

/**
 * Check if a device verification exists (without consuming it).
 * @returns {Promise<boolean>}
 */
export async function hasDeviceVerification(deviceId) {
  if (redis) {
    return (await redis.exists(`device:${deviceId}`)) === 1;
  }
  const entry = deviceVerifyStore.get(deviceId);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    deviceVerifyStore.delete(deviceId);
    return false;
  }
  return true;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * Increment the daily pick counter for a user and check against the limit.
 *
 * Priority: Redis (atomic INCR) → Postgres picks count → in-memory (dev only).
 * Redis is the only truly atomic source. Postgres is a persistent best-effort
 * fallback for when Redis is unavailable in production.
 *
 * @param {string} userId
 * @param {number} limitPerDay  Pass Infinity to skip the check (pro/team).
 * @returns {Promise<{ allowed: boolean, count: number, limit: number }>}
 */
export async function checkAndIncrementRateLimit(userId, limitPerDay) {
  if (!isFinite(limitPerDay)) return { allowed: true, count: 0, limit: Infinity };

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `ratelimit:${userId}:${date}`;

  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, TTL_SECONDS);
    return { allowed: count <= limitPerDay, count, limit: limitPerDay };
  }

  // Postgres fallback — count committed picks for today (persistent across restarts)
  if (pool) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM picks WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
      [userId],
    );
    const count = (result.rows[0]?.count ?? 0) + 1; // +1 for the pick being attempted
    return { allowed: count <= limitPerDay, count, limit: limitPerDay };
  }

  // No Redis, no DB — in-memory map (dev only, resets on restart)
  const inMemStore = checkAndIncrementRateLimit._store ??= new Map();
  const prev = inMemStore.get(key) ?? 0;
  const count = prev + 1;
  inMemStore.set(key, count);
  return { allowed: count <= limitPerDay, count, limit: limitPerDay };
}

// ─── Per-email signup rate limit ──────────────────────────────────────────────
//
// The IP-based limiter on /auth/signup catches a single attacker hammering
// from one address. It does NOT catch a botnet / proxy rotation attacking
// a specific TARGET inbox — each request comes from a different IP, the IP
// limiter never trips, and the target's mailbox fills with magic-link
// emails on our Resend bill.
//
// This counter is keyed by the (normalized) target email. 5 attempts/hour
// is generous for legit retypes/typos and tight enough to make spam
// uneconomic.

const SIGNUP_LIMIT_TTL_SECONDS = 60 * 60;
const SIGNUP_LIMIT_PER_EMAIL = 5;
/** In-memory fallback. Cleaned lazily when it grows. */
const signupAttemptStore = new Map();

function cleanSignupAttempts() {
  if (signupAttemptStore.size < 1000) return;
  const now = Date.now();
  for (const [k, entry] of signupAttemptStore) {
    if (entry.expires < now) signupAttemptStore.delete(k);
  }
}

/**
 * Atomically increment the signup-attempt counter for a given email and
 * report whether the attempt is allowed.
 *
 * @param {string} email  Caller is responsible for trimming + lowercasing.
 * @returns {Promise<{ allowed: boolean, count: number, limit: number }>}
 */
export async function recordSignupAttempt(email) {
  if (!email) return { allowed: true, count: 0, limit: SIGNUP_LIMIT_PER_EMAIL };
  const key = `signup:email:${email}`;

  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, SIGNUP_LIMIT_TTL_SECONDS);
    return { allowed: count <= SIGNUP_LIMIT_PER_EMAIL, count, limit: SIGNUP_LIMIT_PER_EMAIL };
  }

  cleanSignupAttempts();
  const now = Date.now();
  const entry = signupAttemptStore.get(key);
  if (!entry || entry.expires < now) {
    signupAttemptStore.set(key, { count: 1, expires: now + SIGNUP_LIMIT_TTL_SECONDS * 1000 });
    return { allowed: true, count: 1, limit: SIGNUP_LIMIT_PER_EMAIL };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= SIGNUP_LIMIT_PER_EMAIL,
    count: entry.count,
    limit: SIGNUP_LIMIT_PER_EMAIL,
  };
}

// ─── Webhook idempotency ──────────────────────────────────────────────────────
//
// Dodo retries webhook delivery on any non-2xx response, so a transient
// failure mid-handler can lead to the same event being processed twice
// (double-crediting top-ups, double-flipping a plan). markWebhookSeen
// returns true if the id is fresh (and atomically claims it), or false if
// already seen — caller should short-circuit on false.
//
// 24h TTL is well past Dodo's retry budget (typically minutes-to-hours)
// while keeping memory bounded.

const WEBHOOK_TTL_SECONDS = 24 * 60 * 60;
/** In-memory fallback. Bounded by `cleanWebhookSeen` below. */
const seenWebhooks = new Map();

function cleanWebhookSeen() {
  if (seenWebhooks.size < 1000) return;
  const now = Date.now();
  for (const [k, exp] of seenWebhooks) {
    if (exp < now) seenWebhooks.delete(k);
  }
}

/**
 * Atomically mark a webhook id as processed. Returns true if this is the
 * first time we've seen it (caller should process), false if already
 * processed (caller should ack with 200 and skip the handler).
 *
 * @param {string} webhookId
 * @returns {Promise<boolean>}
 */
export async function markWebhookSeen(webhookId) {
  if (!webhookId || typeof webhookId !== 'string') return true; // can't dedupe → allow
  if (redis) {
    // SET ... NX returns 'OK' on fresh insert, null if key already exists.
    const ok = await redis.set(`webhook:seen:${webhookId}`, '1', 'EX', WEBHOOK_TTL_SECONDS, 'NX');
    return ok === 'OK';
  }
  cleanWebhookSeen();
  if (seenWebhooks.has(webhookId)) return false;
  seenWebhooks.set(webhookId, Date.now() + WEBHOOK_TTL_SECONDS * 1000);
  return true;
}

// ─── Monthly attachment quota counters ────────────────────────────────────────
//
// Keys (current calendar month, YYYYMM):
//   attachments_used:<userId>:<YYYYMM>   — picks-with-attachments this month
//   attachments_bonus:<userId>:<YYYYMM>  — top-up packs purchased this month
//
// Both keys live ~40 days so they age out naturally after the month ends.

const MONTH_TTL_SECONDS = 40 * 24 * 60 * 60;

function currentYearMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function attachmentsUsedKey(userId, ym = currentYearMonth()) {
  return `attachments_used:${userId}:${ym}`;
}

function attachmentsBonusKey(userId, ym = currentYearMonth()) {
  return `attachments_bonus:${userId}:${ym}`;
}

/** In-memory fallback for monthly counters (dev only). */
const monthlyCounterStore = new Map();

function memCounterGet(key) {
  return monthlyCounterStore.get(key) ?? 0;
}

function memCounterIncr(key, by = 1) {
  const next = memCounterGet(key) + by;
  monthlyCounterStore.set(key, next);
  return next;
}

/**
 * Read the current month's picks-with-attachments count for a user.
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getAttachmentsUsed(userId) {
  const key = attachmentsUsedKey(userId);
  if (redis) {
    const raw = await redis.get(key);
    return raw ? parseInt(raw, 10) : 0;
  }
  return memCounterGet(key);
}

/**
 * Atomically increment the picks-with-attachments counter (called once per
 * pick that has at least one attachment). Returns the new count.
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function incrementAttachmentsUsed(userId) {
  const key = attachmentsUsedKey(userId);
  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, MONTH_TTL_SECONDS);
    return count;
  }
  return memCounterIncr(key, 1);
}

/**
 * Decrement the picks-with-attachments counter, clamped to >= 0.
 * Called when a pick that had attachments is deleted before being pulled.
 * @param {string} userId
 * @returns {Promise<number>} new count (>= 0)
 */
export async function decrementAttachmentsUsed(userId) {
  const key = attachmentsUsedKey(userId);
  if (redis) {
    const count = await redis.decr(key);
    if (count < 0) {
      await redis.set(key, "0", "EX", MONTH_TTL_SECONDS);
      return 0;
    }
    return count;
  }
  const next = Math.max(0, memCounterGet(key) - 1);
  monthlyCounterStore.set(key, next);
  return next;
}

/**
 * Read the current month's bonus pick count from purchased top-up packs.
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getAttachmentBonus(userId) {
  const key = attachmentsBonusKey(userId);
  if (redis) {
    const raw = await redis.get(key);
    return raw ? parseInt(raw, 10) : 0;
  }
  return memCounterGet(key);
}

/**
 * Add to the current month's bonus counter (called by the top-up webhook).
 * @param {string} userId
 * @param {number} amount  e.g. 25 for the $5 pack
 * @returns {Promise<number>} new total
 */
export async function incrementAttachmentBonus(userId, amount) {
  const key = attachmentsBonusKey(userId);
  if (redis) {
    const count = await redis.incrby(key, amount);
    // Always reset TTL on a top-up so the bonus survives the rest of the month.
    await redis.expire(key, MONTH_TTL_SECONDS);
    return count;
  }
  return memCounterIncr(key, amount);
}

// ─── Expose redis client ──────────────────────────────────────────────────────

/**
 * Expose the redis client so index.js can confirm connectivity on startup.
 */
export { redis };
