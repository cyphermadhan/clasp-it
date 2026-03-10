/**
 * Storage helpers — Redis-backed with in-memory fallback for local dev.
 *
 * Redis key layout:
 *   picks:<userId>  →  Redis List, index 0 = most recent, capped at 10
 */

import { createRequire } from 'module';

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
    await redis.del(redisKey);
    return deserialize(value);
  } else {
    const entry = deviceVerifyStore.get(deviceId);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      deviceVerifyStore.delete(deviceId);
      return null;
    }
    deviceVerifyStore.delete(deviceId);
    return deserialize(entry.value);
  }
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

/** In-memory rate limit store for dev (no Redis). */
const rateLimitStore = new Map();

/**
 * Increment the daily pick counter for a user and check against the limit.
 *
 * Redis key: `ratelimit:<userId>:<YYYY-MM-DD>` — expires after 24h.
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

  const prev = rateLimitStore.get(key) ?? 0;
  const count = prev + 1;
  rateLimitStore.set(key, count);
  return { allowed: count <= limitPerDay, count, limit: limitPerDay };
}

// ─── Expose redis client ──────────────────────────────────────────────────────

/**
 * Expose the redis client so index.js can confirm connectivity on startup.
 */
export { redis };
