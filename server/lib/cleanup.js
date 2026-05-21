/**
 * Scheduled cleanup for orphan attachment files.
 *
 * Runs once a day. Deletes any attachment whose `created_at` is older than
 * CLEANUP_OLDER_THAN_DAYS (default 28). The pick row itself stays — it's
 * an analytics record. We just nuke the R2 object + the attachments-table row.
 *
 * Why a sweeper:
 *   The happy path is auto-delete on `update_pick_status` → completed (in
 *   routes/mcp.js). That covers picks Claude actually closed out. If Claude
 *   reads a pick, marks it in_progress, and never flips to completed, the R2
 *   object lingers forever. Same for picks that fall off the 24h Redis ring
 *   buffer without ever being completed. This sweeper catches those.
 *
 * Idempotent. Safe to run multiple times — second run just finds zero rows.
 * R2 deletes are best-effort; failures are logged but don't block DB cleanup
 * (re-run will skip already-deleted rows because we DELETE the DB row last).
 */

import { pool } from './db.js';
import { deleteObjects, r2Enabled } from './r2.js';

const BATCH_SIZE = 500;

/**
 * Delete attachments older than the cutoff in batches.
 * @param {object} [opts]
 * @param {number} [opts.olderThanDays=28]
 * @returns {Promise<{ deleted: number, batches: number }>}
 */
export async function cleanupOldAttachments({ olderThanDays = 28 } = {}) {
  if (!pool) {
    console.log('[cleanup] No DB — skipping attachment cleanup');
    return { deleted: 0, batches: 0 };
  }

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;
  let batches = 0;

  // Loop until a batch returns fewer than BATCH_SIZE rows.
  // Each iteration: fetch → R2-delete → DB-delete (so a crash mid-loop
  // leaves rows in place to be retried, never orphans R2 keys).
  while (true) {
    const result = await pool.query(
      `SELECT id, r2_key, pick_id, user_id
       FROM attachments
       WHERE created_at < $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [cutoff, BATCH_SIZE],
    );
    if (result.rows.length === 0) break;
    batches++;

    const keys = result.rows.map((r) => r.r2_key).filter(Boolean);
    const ids = result.rows.map((r) => r.id);

    if (r2Enabled && keys.length > 0) {
      // deleteObjects already swallows its own errors and logs them.
      // Failures here mean the R2 object stays; the DB row will be removed
      // anyway. That's an orphan in R2 — acceptable, R2 has no DB FK.
      await deleteObjects(keys);
    }

    await pool.query(
      `DELETE FROM attachments WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    totalDeleted += result.rows.length;
    if (result.rows.length < BATCH_SIZE) break;
  }

  if (totalDeleted > 0) {
    console.log(`[cleanup] Removed ${totalDeleted} attachment(s) older than ${olderThanDays}d (in ${batches} batch(es))`);
  }

  return { deleted: totalDeleted, batches };
}
