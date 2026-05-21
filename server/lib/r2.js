/**
 * Cloudflare R2 client wrapper.
 *
 * Uses the S3-compatible API via @aws-sdk/client-s3.
 * If any R2_* env var is missing, all operations no-op and return null —
 * matches the graceful-degradation pattern used in db.js / storage.js.
 *
 * Required env vars (set on Railway, not committed locally):
 *   R2_ACCOUNT_ID         — the subdomain in your R2 endpoint URL
 *   R2_ACCESS_KEY_ID      — from "Manage R2 API Tokens" → Object Read & Write
 *   R2_SECRET_ACCESS_KEY  — same dialog, shown once
 *   R2_BUCKET             — bucket name (e.g. claspit-attachments)
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
} = process.env;

let client = null;
export const r2Enabled = Boolean(
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET,
);

if (r2Enabled) {
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  console.log(`[r2] Connected to bucket "${R2_BUCKET}"`);
} else {
  console.warn('[r2] R2_* env vars not set — attachment storage disabled');
}

/**
 * Build a deterministic R2 key for an attachment.
 * Format: picks/<userId>/<pickId>/<attachmentId>.<ext>
 */
export function buildAttachmentKey({ userId, pickId, attachmentId, ext }) {
  const safeExt = (ext || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `picks/${userId}/${pickId}/${attachmentId}.${safeExt}`;
}

/**
 * Upload an object to R2.
 * @param {{ key: string, body: Buffer|Uint8Array, contentType: string }} args
 * @returns {Promise<{ key: string }|null>} null if R2 disabled
 */
export async function putObject({ key, body, contentType }) {
  if (!client) return null;
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { key };
}

/**
 * Delete a single object. Best-effort — swallows errors.
 * @param {string} key
 */
export async function deleteObject(key) {
  if (!client) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (err) {
    console.warn(`[r2] deleteObject(${key}) failed:`, err.message);
  }
}

/**
 * Delete multiple objects in one round-trip. Best-effort — swallows errors.
 * @param {string[]} keys
 */
export async function deleteObjects(keys) {
  if (!client || keys.length === 0) return;
  try {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  } catch (err) {
    console.warn(`[r2] deleteObjects(${keys.length} keys) failed:`, err.message);
  }
}

/**
 * Generate a signed GET URL for a stored object.
 * @param {string} key
 * @param {number} [expiresInSeconds=3600] — defaults to 1 hour, per spec
 * @returns {Promise<string|null>} null if R2 disabled
 */
export async function getSignedUrl(key, expiresInSeconds = 3600) {
  if (!client) return null;
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return await awsGetSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
