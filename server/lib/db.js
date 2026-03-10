/**
 * Postgres connection pool + schema initialisation.
 *
 * Set DATABASE_URL in the environment to enable Postgres.
 * Without it, all DB operations are no-ops (local dev with in-memory storage only).
 */

import pg from 'pg';

const { Pool } = pg;

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('neon') ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (err) => console.error('[db] Pool error:', err.message));
} else {
  console.warn('[db] DATABASE_URL not set — Postgres features disabled');
}

/**
 * Run the schema migrations (idempotent — safe to call on every startup).
 */
export async function initSchema() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email             TEXT UNIQUE NOT NULL,
      dodo_customer_id  TEXT,
      plan              TEXT NOT NULL DEFAULT 'free',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      token       TEXT PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      used        BOOLEAN NOT NULL DEFAULT false
    );

    ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS device_id TEXT;

    CREATE TABLE IF NOT EXISTS api_keys (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash      TEXT UNIQUE NOT NULL,
      key_prefix    TEXT NOT NULL,
      label         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at  TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS picks (
      id              TEXT PRIMARY KEY,
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page_url        TEXT,
      selector        TEXT,
      prompt          TEXT,
      plan_at_time    TEXT,
      had_screenshot  BOOLEAN DEFAULT false,
      had_console     BOOLEAN DEFAULT false,
      had_network     BOOLEAN DEFAULT false,
      had_react       BOOLEAN DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE picks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'not_started';
  `);

  console.log('[db] Schema initialised');
}

export { pool };