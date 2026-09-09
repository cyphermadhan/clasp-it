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
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  storePick,
  getPickStatuses,
  checkAndIncrementRateLimit,
  getPickById,
  updatePickPrompt,
  addAttachmentToPick,
  removeAttachmentFromPick,
  incrementAttachmentsUsed,
  decrementAttachmentsUsed,
  removePickFromList,
  removeCompletedPicks,
  listRecentPicks,
} from '../lib/storage.js';
import { requireApiKey, gatePayload, PLANS, getAttachmentQuota } from '../lib/auth.js';
import { pool } from '../lib/db.js';
import { r2Enabled, putObject, deleteObject, deleteObjects, buildAttachmentKey } from '../lib/r2.js';
import { apiKeyLimiter } from '../lib/ratelimit.js';

// 10 req/sec/key — generous, accommodates the extension's 5-second poll
// across 20+ open picks plus normal usage. Real abuse hits this fast.
const apiLimit = apiKeyLimiter({ max: 600, windowMs: 60_000 });

const router = Router();

// Derives a short "TAG.class" label for a picked element (e.g. "BUTTON.btn-primary").
// Shared by the POST insert (persisted to Postgres) and both /recent branches
// (Redis fallback + Postgres-backed) so the label formula stays in one place.
function elementLabelFor(el) {
  const tag = el?.tagName || 'element';
  const firstClass = Array.isArray(el?.classList) ? el.classList[0] : null;
  return tag + (firstClass ? `.${firstClass}` : '');
}

// ─── Multer (multipart parser) ────────────────────────────────────────────────
// Memory storage — files are forwarded straight to R2, no disk hop.
// Hard upper bound = 25MB (max plan ceiling); per-plan size enforced in handler.

const HARD_FILE_CAP = 25 * 1024 * 1024;
const HARD_FILE_COUNT = 3;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_FILE_CAP, files: HARD_FILE_COUNT },
});

// MIME → file extension. Used to build the R2 object key.
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'application/json': 'json',
};

router.post('/', requireApiKey, apiLimit, async (req, res) => {
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
              had_screenshot, had_console, had_network, had_react, element_label)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
            elementLabelFor(el),
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

router.get('/statuses', requireApiKey, apiLimit, async (req, res) => {
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

// ─── GET /element-context/quota ───────────────────────────────────────────────
// Returns the caller's monthly attachment quota for the current month.
// Static path — declared before any /:id routes so Express matches it first.

router.get('/quota', requireApiKey, apiLimit, async (req, res) => {
  try {
    const quota = await getAttachmentQuota(req.userId, req.userPlan);
    return res.json(quota);
  } catch (err) {
    console.error('[quota] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /element-context/recent ──────────────────────────────────────────────
// Lightweight snapshot of the caller's stored picks, shaped for the extension
// to hydrate local history — e.g. the same API key pasted into a second
// install (a locally-loaded dev copy) that has no local history of its own,
// since chrome.storage.local is scoped per-extension-id, not per-account.
// Static path — declared before any /:id routes so Express matches it first.

router.get('/recent', requireApiKey, apiLimit, async (req, res) => {
  const { userId, userPlan } = req;

  try {
    // Postgres holds the account's full history (persistent, never trimmed
    // except on explicit delete) — prefer it so hydration reflects the
    // plan's real historyLimit (free: 5, pro: 50, max: 200), not just
    // whatever's still in the AI's 10-pick Redis working set. Falls back to
    // Redis when Postgres isn't configured (local dev, matching this repo's
    // graceful-degradation convention elsewhere).
    if (pool) {
      const limit = (PLANS[userPlan] ?? PLANS.free).historyLimit;

      const { rows } = await pool.query(
        `SELECT id, page_url, element_label, prompt, status, created_at
           FROM picks
          WHERE user_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, limit],
      );

      const ids = rows.map((r) => r.id);
      const attachmentsByPick = new Map();
      if (ids.length > 0) {
        const { rows: atts } = await pool.query(
          `SELECT pick_id, id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes"
             FROM attachments
            WHERE pick_id = ANY($1) AND user_id = $2`,
          [ids, userId],
        );
        for (const a of atts) {
          const list = attachmentsByPick.get(a.pick_id) ?? [];
          list.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes });
          attachmentsByPick.set(a.pick_id, list);
        }
      }

      const shaped = rows.map((r) => {
        const attachments = attachmentsByPick.get(r.id) ?? [];
        return {
          pickId: r.id,
          elementLabel: r.element_label || 'element',
          pageURL: r.page_url ?? '',
          prompt: r.prompt ?? '',
          status: r.status ?? 'not_started',
          sentAt: r.created_at,
          attachmentCount: attachments.length,
          attachments,
        };
      });
      return res.json({ picks: shaped });
    }

    const picks = await listRecentPicks(userId);
    const shaped = picks.map((p) => {
      const el = p.element ?? {};
      return {
        pickId: p.id,
        elementLabel: elementLabelFor(el),
        pageURL: el.pageURL ?? '',
        prompt: p.prompt ?? '',
        status: p.status ?? 'not_started',
        sentAt: p.timestamp,
        attachmentCount: Array.isArray(p.attachments) ? p.attachments.length : 0,
        attachments: (p.attachments ?? []).map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
      };
    });
    return res.json({ picks: shaped });
  } catch (err) {
    console.error('[element-context] GET recent error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /element-context/:id ───────────────────────────────────────────────
// Edit a pick's prompt while it's still not_started. Returns 409 once Claude
// has pulled it (status flipped to in_progress or completed).

router.patch('/:id', requireApiKey, apiLimit, async (req, res) => {
  const { id } = req.params;
  const { prompt } = req.body ?? {};

  if (typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt must be a string' });
  }

  try {
    const pick = await getPickById(req.userId, id);
    if (!pick) return res.status(404).json({ error: 'Pick not found' });

    if (pick.status && pick.status !== 'not_started') {
      return res.status(409).json({
        error: 'Pick already pulled — cannot edit',
        status: pick.status,
      });
    }

    const updated = await updatePickPrompt(req.userId, id, prompt);
    return res.json({ success: true, pick: updated });
  } catch (err) {
    console.error('[element-context] PATCH error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /element-context/completed ────────────────────────────────────────
// Bulk-clear every pick marked completed. Frees slots in the server's 10-pick
// ring buffer so older completed picks don't crowd out in-flight ones, and
// list_recent_picks/get_element_context aren't cluttered with finished work.
// Must be registered before /:id or Express would treat "completed" as an id.

router.delete('/completed', requireApiKey, apiLimit, async (req, res) => {
  const { userId } = req;

  try {
    const removed = await removeCompletedPicks(userId);

    // Postgres holds the account's full history, which outlives the 10-pick
    // Redis ring buffer above — a completed pick can already have aged out
    // of that buffer (evicted by newer picks) while still sitting in
    // Postgres with deleted_at NULL. Only purging what removeCompletedPicks
    // found left those rows behind, and they'd resurrect via GET /recent
    // the next time the extension hydrates history from the server. So
    // purge every completed, not-yet-deleted pick directly from Postgres
    // too, and union the ids with whatever the Redis pass removed.
    let purgeIds = removed.map((p) => p.id);
    if (pool) {
      const { rows } = await pool.query(
        `SELECT id FROM picks WHERE user_id = $1 AND status = 'completed' AND deleted_at IS NULL`,
        [userId],
      );
      purgeIds = [...new Set([...purgeIds, ...rows.map((r) => r.id)])];
    }

    if (pool && purgeIds.length > 0) {
      const { rows: atts } = await pool.query(
        'SELECT r2_key FROM attachments WHERE pick_id = ANY($1) AND user_id = $2',
        [purgeIds, userId],
      );
      const keys = atts.map((a) => a.r2_key).filter(Boolean);
      if (keys.length > 0) await deleteObjects(keys);

      await pool
        .query('DELETE FROM attachments WHERE pick_id = ANY($1) AND user_id = $2', [purgeIds, userId])
        .catch((err) => console.warn('[element-context] DELETE completed attachments cleanup failed:', err.message));

      await pool
        .query('UPDATE picks SET deleted_at = now() WHERE id = ANY($1) AND user_id = $2', [purgeIds, userId])
        .catch((err) => console.warn('[element-context] DELETE completed history purge failed:', err.message));
    } else {
      // No pool (local dev) — fall back to whatever the Redis-only pass found.
      const keys = removed.flatMap((p) => p.attachments ?? []).map((a) => a.r2Key).filter(Boolean);
      if (keys.length > 0) await deleteObjects(keys);
    }

    return res.json({ success: true, removed: purgeIds.length });
  } catch (err) {
    console.error('[element-context] DELETE completed error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /element-context/:id ──────────────────────────────────────────────
// Cancel a pick before Claude has pulled it. Removes the pick from the user's
// list, deletes any R2 attachments + DB rows, and decrements the monthly
// counter so the user isn't charged for a pick they cancelled.

router.delete('/:id', requireApiKey, apiLimit, async (req, res) => {
  const { id: pickId } = req.params;
  const { userId } = req;

  try {
    const pick = await getPickById(userId, pickId);
    if (!pick) return res.status(404).json({ error: 'Pick not found' });

    if (pick.status && pick.status !== 'not_started') {
      return res.status(409).json({
        error: 'Pick already pulled — cannot delete',
        status: pick.status,
      });
    }

    const attachments = pick.attachments ?? [];
    if (attachments.length > 0) {
      const keys = attachments.map((a) => a.r2Key).filter(Boolean);
      await deleteObjects(keys);
      if (pool) {
        await pool
          .query('DELETE FROM attachments WHERE pick_id = $1 AND user_id = $2', [pickId, userId])
          .catch((err) => console.warn('[element-context] DELETE attachments cleanup failed:', err.message));
      }
      // Counter only ever increments once per pick (on first batch upload),
      // so decrement once on delete.
      await decrementAttachmentsUsed(userId);
    }

    await removePickFromList(userId, pickId);

    // Mark gone in persistent history too, so a cancelled pick doesn't
    // resurface via GET /recent on a fresh install.
    if (pool) {
      pool
        .query('UPDATE picks SET deleted_at = now() WHERE id = $1 AND user_id = $2', [pickId, userId])
        .catch((err) => console.warn('[element-context] DELETE history purge failed:', err.message));
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[element-context] DELETE error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /element-context/:id/attachments ────────────────────────────────────
// Multipart upload (1+ files). Validates type/size/count against the caller's
// plan, uploads each file to R2, persists metadata, and updates the pick's
// in-Redis attachments list. Increments the monthly counter once per pick.

router.post('/:id/attachments', requireApiKey, apiLimit, upload.array('files', HARD_FILE_COUNT), async (req, res) => {
  const { id: pickId } = req.params;
  const { userId, userPlan } = req;
  const planDef = PLANS[userPlan] ?? PLANS.free;

  if (!r2Enabled) {
    return res.status(503).json({ error: 'Attachment storage is not configured' });
  }

  if (!planDef.attachmentsPerPick || planDef.attachmentsPerPick === 0) {
    return res.status(403).json({ error: 'Attachments are a Pro-plan feature' });
  }

  const files = req.files ?? [];
  if (files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const pick = await getPickById(userId, pickId);
    if (!pick) return res.status(404).json({ error: 'Pick not found' });

    if (pick.status && pick.status !== 'not_started') {
      return res.status(409).json({
        error: 'Pick already pulled — cannot add attachments',
        status: pick.status,
      });
    }

    const existing = pick.attachments ?? [];
    if (existing.length + files.length > planDef.attachmentsPerPick) {
      return res.status(403).json({
        error: `Limit ${planDef.attachmentsPerPick} attachments per pick`,
        existing: existing.length,
        attempted: files.length,
      });
    }

    // Per-file validation against the plan's caps.
    for (const file of files) {
      if (file.size > planDef.maxFileSizeBytes) {
        return res.status(413).json({
          error: `File "${file.originalname}" exceeds ${planDef.maxFileSizeBytes} bytes`,
        });
      }
      if (!planDef.attachmentTypesAllowed.includes(file.mimetype)) {
        return res.status(415).json({
          error: `Unsupported file type: ${file.mimetype}`,
        });
      }
    }

    // First-attachment quota gate: if the pick has no attachments yet, this
    // upload will count it as a "pick-with-attachments" against the monthly
    // cap. Check before any R2 writes so a denied request is reversible.
    const isFirstBatch = existing.length === 0;
    if (isFirstBatch) {
      const quota = await getAttachmentQuota(userId, userPlan);
      if (quota.remaining <= 0) {
        return res.status(429).json({
          error: 'Monthly attachment limit reached',
          quota,
        });
      }
    }

    // Upload each file to R2 + record metadata.
    const created = [];
    for (const file of files) {
      const attachmentId = uuidv4();
      const ext = MIME_TO_EXT[file.mimetype]
        ?? path.extname(file.originalname).replace(/^\./, '')
        ?? 'bin';
      const r2Key = buildAttachmentKey({ userId, pickId, attachmentId, ext });

      await putObject({ key: r2Key, body: file.buffer, contentType: file.mimetype });

      if (pool) {
        await pool.query(
          `INSERT INTO attachments
             (id, pick_id, user_id, r2_key, filename, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [attachmentId, pickId, userId, r2Key, file.originalname, file.mimetype, file.size],
        );
      }

      const attachment = {
        id: attachmentId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        r2Key,
      };
      await addAttachmentToPick(userId, pickId, attachment);
      created.push(attachment);
    }

    if (isFirstBatch) {
      await incrementAttachmentsUsed(userId);
    }

    const quota = await getAttachmentQuota(userId, userPlan);
    return res.status(201).json({ success: true, attachments: created, quota });
  } catch (err) {
    console.error('[attachments] POST error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /element-context/:id/attachments/:attachmentId ────────────────────

router.delete('/:id/attachments/:attachmentId', requireApiKey, apiLimit, async (req, res) => {
  const { id: pickId, attachmentId } = req.params;
  const { userId } = req;

  try {
    const pick = await getPickById(userId, pickId);
    if (!pick) return res.status(404).json({ error: 'Pick not found' });

    if (pick.status && pick.status !== 'not_started') {
      return res.status(409).json({
        error: 'Pick already pulled — cannot remove attachments',
        status: pick.status,
      });
    }

    const target = (pick.attachments ?? []).find((a) => a.id === attachmentId);
    if (!target) return res.status(404).json({ error: 'Attachment not found' });

    await deleteObject(target.r2Key);

    if (pool) {
      await pool.query('DELETE FROM attachments WHERE id = $1 AND user_id = $2', [
        attachmentId,
        userId,
      ]).catch((err) => console.warn('[attachments] DB delete failed:', err.message));
    }

    const updated = await removeAttachmentFromPick(userId, pickId, attachmentId);

    // If this was the last attachment on the pick, the pick no longer counts
    // against the monthly quota — give the user back their counter slot.
    // Mirrors the increment rule, which only fires on the FIRST batch upload.
    const remaining = updated?.attachments?.length ?? 0;
    let quota = null;
    if (remaining === 0) {
      await decrementAttachmentsUsed(userId);
    }
    quota = await getAttachmentQuota(userId, req.userPlan);

    return res.json({ success: true, quota });
  } catch (err) {
    console.error('[attachments] DELETE error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Multer error handler ─────────────────────────────────────────────────────
// Catches LIMIT_FILE_SIZE / LIMIT_FILE_COUNT before they hit the global handler.

router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ error: err.message, code: err.code });
  }
  return next(err);
});

export default router;
