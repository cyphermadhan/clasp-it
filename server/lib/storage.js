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
 * Retrieve and immediately delete a device verification (one-time claim).
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
