/**
 * clasp-it — Express entry point
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

import elementRouter from './routes/element.js';
import mcpRouter from './routes/mcp.js';
import authRouter from './routes/auth.js';

import { redis } from './lib/storage.js';
import { initSchema, pool } from './lib/db.js';
import { cleanupOldAttachments } from './lib/cleanup.js';

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();

// Railway / Cloudflare put us behind one reverse-proxy hop. Trusting that
// hop lets req.ip (and downstream rate limiters) see the real client IP
// from X-Forwarded-For. `1` (not `true`) avoids over-trusting arbitrary
// upstream hops — see https://expressjs.com/en/guide/behind-proxies.html
app.set('trust proxy', 1);

// Allow all origins for now — tighten in production via CORS_ORIGIN env var.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'webhook-id', 'webhook-signature', 'webhook-timestamp'],
  }),
);

// Enforce HTTPS via HSTS (only meaningful in production behind TLS)
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Webhook route needs the raw body for HMAC signature verification.
// Must be registered BEFORE express.json() — once json() runs, raw bytes are gone.
app.use('/auth/webhook', express.raw({ type: 'application/json', limit: '1mb' }));

// 5 MB matches the attachment-per-file cap. Pro picks include base64
// screenshots that on hi-DPI displays can comfortably exceed 1 MB; a
// generous JSON limit avoids silent 413s. Free-tier picks have a tighter
// 50 KB guard at routes/element.js (rejects screenshots etc).
app.use(express.json({ limit: '5mb' }));

// Agent discovery: Link headers on homepage (RFC 8288)
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.setHeader('Link', [
      '</.well-known/mcp/server-card.json>; rel="mcp-server-card"',
      '</.well-known/api-catalog>; rel="api-catalog"',
      '</auth.md>; rel="service-doc"',
    ].join(', '));
  }
  next();
});

// Agent discovery: markdown negotiation for homepage
app.get('/', (req, res, next) => {
  if (req.headers.accept?.includes('text/markdown')) {
    const md = [
      '# Clasp-it\n',
      'Pick any webpage element and send its full context to Claude Code via MCP.\n',
      '## Quick start',
      '1. Install from Chrome Web Store',
      '2. Click any element → add a prompt → send',
      '3. Claude Code receives HTML, CSS, selector, screenshot\n',
      '## MCP install',
      '```bash',
      'claude mcp add --transport http clasp-it https://claspit.dev/mcp --header "Authorization: Bearer YOUR_API_KEY"',
      '```\n',
      '## Links',
      '- [Auth docs](/auth.md)',
      '- [MCP Server Card](/.well-known/mcp/server-card.json)',
      '- [Health](/health)',
    ].join('\n');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.send(md);
  }
  next();
});

// Serve api-catalog with correct content-type (extensionless file)
app.get('/.well-known/api-catalog', (_req, res) => {
  res.setHeader('Content-Type', 'application/linkset+json');
  res.sendFile(join(__dirname, 'public', '.well-known', 'api-catalog'));
});

app.use(express.static(join(__dirname, 'public'), { extensions: ['html'] }));

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    storage: redis ? 'redis' : 'memory',
    ts: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/auth', authRouter);
app.use('/billing', authRouter);
app.use('/element-context', elementRouter);
app.use('/picks', elementRouter);
app.use('/mcp', mcpRouter);

// ─── Agent discovery (isitagentready.com compliance) ─────────────────────────
// Static files handle: robots.txt, auth.md, .well-known/mcp/server-card.json,
// .well-known/api-catalog, .well-known/agent-skills/index.json.
// Only the Link headers and markdown negotiation need middleware/routes.

// ─── 404 catch-all ────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// In production, in-memory fallback would silently disable auth (any string
// becomes a valid API key — see lib/auth.js requireApiKey). Refuse to start
// if DATABASE_URL is missing in production. Dev mode keeps the fallback for
// local hacking without a DB.
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.error('[server] FATAL: DATABASE_URL is required in production — refusing to start');
  process.exit(1);
}

// Initialise Postgres schema (idempotent) then start listening.
// Non-fatal: a schema error should not prevent the server from starting.
await initSchema().catch(err => console.error('[db] Schema init failed (non-fatal):', err.message));

const httpServer = app.listen(PORT, () => {
  console.log(`[server] clasp-it listening on port ${PORT}`);
  console.log(`[server] Storage: ${redis ? 'Redis' : 'in-memory (dev)'}`);
});

// ─── Scheduled cleanup ────────────────────────────────────────────────────────
// Sweep R2 + attachments table for picks older than CLEANUP_OLDER_THAN_DAYS.
// Runs once on boot (after a 60s grace) and then every CLEANUP_INTERVAL_HOURS.

const CLEANUP_OLDER_THAN_DAYS = parseInt(process.env.CLEANUP_OLDER_THAN_DAYS ?? '28', 10);
const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS ?? '24', 10);
const CLEANUP_INTERVAL_MS = CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;

function runCleanup() {
  cleanupOldAttachments({ olderThanDays: CLEANUP_OLDER_THAN_DAYS })
    .catch((err) => console.error('[cleanup] run failed:', err.message));
}

// 60s grace lets DB connections settle and avoids competing with start-up
// traffic. After that, run every CLEANUP_INTERVAL_HOURS.
const cleanupBootTimer = setTimeout(runCleanup, 60 * 1000);
const cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
console.log(`[cleanup] Scheduled: every ${CLEANUP_INTERVAL_HOURS}h, removing attachments older than ${CLEANUP_OLDER_THAN_DAYS}d`);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Railway sends SIGTERM with a ~10s grace before SIGKILL. Drain in-flight
// requests, close pools, then exit. Idempotent — the `shuttingDown` flag
// guards against duplicate signal delivery.

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] Received ${signal} — shutting down gracefully`);

  // Hard cap: if any close hangs, kill the process after 9s so Railway
  // doesn't have to SIGKILL us.
  const killTimer = setTimeout(() => {
    console.error('[server] Shutdown took too long — forcing exit');
    process.exit(1);
  }, 9_000);
  killTimer.unref();

  clearTimeout(cleanupBootTimer);
  clearInterval(cleanupInterval);

  // Stop accepting new connections; existing requests get to finish.
  await new Promise((resolve) => httpServer.close(resolve));

  // Close DB + Redis. Both swallow their own errors so one failure doesn't
  // block the other.
  await Promise.allSettled([
    pool ? pool.end() : Promise.resolve(),
    redis ? redis.quit() : Promise.resolve(),
  ]);

  console.log('[server] Goodbye');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
