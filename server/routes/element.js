/**
 * POST /element-context
 *
 * Accepts a JSON payload describing a picked DOM element.
 * Authenticates via X-API-Key, enforces daily rate limits, strips
 * pro-gated fields for free-tier users, stores the pick in Redis,
 * and logs analytics to Postgres.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { storePick, getPickStatuses, checkAndIncrementRateLimit } from '../lib/storage.js';
import { requireApiKey, gatePayload, PLANS } from '../lib/auth.js';
import { pool } from '../lib/db.js';

const router = Router();

router.post('/', requireApiKey, async (req, res) => {
  try {
    const { userId, userPlan } = req;
    const planDef = PLANS[userPlan] ?? PLANS.free;

    // ── Rate limiting ──────────────────────────────────────────────────────────
    const { allowed, count, limit } = await checkAndIncrementRateLimit(
      userId,
      planDef.picksPerDay,
    );

    if (!allowed) {
      return res.status(429).json({
        success: false,
        error: `Daily pick limit reached (${limit}/day). Upgrade to Pro for unlimited picks.`,
        count,
        limit,
      });
    }

    // ── Payload size guard for free users ──────────────────────────────────────
    // Free users shouldn't be sending large pro payloads (screenshots etc).
    // Reject early rather than accept, process, and discard.
    if (userPlan !== 'pro') {
      const bytes = parseInt(req.headers['content-length'] ?? '0', 10);
      if (bytes > 50 * 1024) {
        return res.status(413).json({ success: false, error: 'Payload too large for free plan' });
      }
    }

    // ── Feature gating ─────────────────────────────────────────────────────────
    const payload = gatePayload(req.body, userPlan);

    // ── Build pick ─────────────────────────────────────────────────────────────
    const id = `pick_${crypto.randomBytes(8).toString('hex')}`;
    const timestamp = new Date().toISOString();

    const pick = { ...payload, id, timestamp, status: 'not_started' };

    // ── Store in Redis (primary retrieval store) ───────────────────────────────
    await storePick(userId, pick);

    // ── Persist analytics to Postgres (best-effort, non-blocking) ─────────────
    if (pool) {
      const el = pick.element ?? {};
      const toggles = pick.toggles ?? {};
      const ctx = pick.context ?? {};

      pool
        .query(
          `INSERT INTO picks
             (id, user_id, page_url, selector, prompt, plan_at_time,
              had_screenshot, had_console, had_network, had_react)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            userId,
            pick.pageURL ?? el.pageURL ?? null,
            el.selector ?? null,
            pick.prompt ?? null,
            userPlan,
            Boolean(toggles.screenshot || ctx.screenshot),
            Boolean(toggles.console || ctx.consoleLogs),
            Boolean(toggles.network || ctx.networkRequests),
            Boolean(toggles.react || ctx.reactProps),
          ],
        )
        .catch((err) => console.error('[element-context] Analytics insert failed:', err.message));
    }

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('[element-context] Error storing pick:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── GET /picks/statuses ──────────────────────────────────────────────────────
// Returns { pickId: status } for a list of IDs. Used by the extension sidebar
// to poll status for history items.

router.get('/statuses', requireApiKey, async (req, res) => {
  const raw = req.query.ids ?? '';
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.json({});

  try {
    const statuses = await getPickStatuses(req.userId, ids);
    return res.json(statuses);
  } catch (err) {
    console.error('[picks] statuses error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
