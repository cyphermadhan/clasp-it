/**
 * POST /element-context
 *
 * Accepts a JSON payload describing a picked DOM element.
 * Authenticates via X-API-Key, enforces daily rate limits, strips
 * pro-gated fields for free-tier users, stores the pick in Redis,
 * and logs analytics to Postgres.
 */

import { Router } from 'express';
import { storePick } from '../lib/storage.js';
import { checkAndIncrementRateLimit } from '../lib/storage.js';
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

    // ── Feature gating ─────────────────────────────────────────────────────────
    const payload = gatePayload(req.body, userPlan);

    // ── Build pick ─────────────────────────────────────────────────────────────
    const id = `pick_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const pick = { ...payload, id, timestamp };

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

export default router;
