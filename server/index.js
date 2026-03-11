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
import { initSchema } from './lib/db.js';

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();

// Allow all origins for now — tighten in production via CORS_ORIGIN env var.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'webhook-id', 'webhook-signature', 'webhook-timestamp'],
  }),
);

app.use(express.json({ limit: '1mb' }));
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

// Initialise Postgres schema (idempotent) then start listening.
// Non-fatal: a schema error should not prevent the server from starting.
await initSchema().catch(err => console.error('[db] Schema init failed (non-fatal):', err.message));

app.listen(PORT, () => {
  console.log(`[server] clasp-it listening on port ${PORT}`);
  console.log(`[server] Storage: ${redis ? 'Redis' : 'in-memory (dev)'}`);
});
