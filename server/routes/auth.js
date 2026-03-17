/**
 * Auth + billing routes
 *
 * POST   /auth/signup           — upsert user by email, send magic link
 * GET    /auth/verify/:token    — validate magic link → return session token
 * GET    /auth/me               — current user info (requires session)
 * POST   /auth/keys             — create API key (requires session)
 * DELETE /auth/keys/:id         — revoke API key (requires session)
 * POST   /auth/webhook          — Dodo Payments webhook
 * POST   /billing/checkout      — create Dodo Payments checkout (requires session)
 * GET    /billing/portal        — Dodo customer portal URL (requires session)
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../lib/db.js';
import { requireSession, requireApiKey, generateApiKey, hashKey, createSession, PLANS } from '../lib/auth.js';
import { storeDeviceVerification, claimDeviceVerification, hasDeviceVerification } from '../lib/storage.js';

const router = Router();

// ─── Simple IP-based rate limiter for auth endpoints ──────────────────────────
// In-memory; resets on server restart. Good enough for abuse prevention.

const signupRateLimit = new Map(); // ip → { count, resetAt }

function checkSignupRateLimit(ip) {
  const now = Date.now();
  const entry = signupRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    signupRateLimit.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 }); // 1h window
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

// ─── Email validation ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email) && email.length <= 254;
}

// ─── Email helper ─────────────────────────────────────────────────────────────

async function sendMagicLink(email, token) {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3001';
  const link = `${appUrl}/auth/verify/${token}`;

  if (!process.env.RESEND_API_KEY) {
    // Dev mode: log the link instead of sending email
    console.log(`[auth] Magic link for ${email}: [link omitted — dev mode]`);
    return;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'noreply@clasp-it.com',
    to: email,
    subject: 'Sign in to Clasp It',
    html: `
      <p>Click the link below to sign in. It expires in 15 minutes.</p>
      <p><a href="${link}">${link}</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
  });
}

// ─── POST /auth/signup ────────────────────────────────────────────────────────

router.post('/signup', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (!checkSignupRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }

  const { email, deviceId } = req.body ?? {};
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  if (!pool) {
    return res.status(503).json({ error: 'Database not available in dev mode — set DATABASE_URL' });
  }

  try {
    // Upsert user
    const userResult = await pool.query(
      `INSERT INTO users (email)
       VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email.toLowerCase().trim()],
    );
    const userId = userResult.rows[0].id;

    // Create magic link token (expires in 15 minutes), optionally linked to a deviceId
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'INSERT INTO magic_links (token, user_id, expires_at, device_id) VALUES ($1, $2, $3, $4)',
      [token, userId, expiresAt, deviceId ?? null],
    );

    await sendMagicLink(email, token);

    return res.json({ success: true, message: 'Magic link sent — check your email' });
  } catch (err) {
    console.error('[auth] signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /auth/verify/:token ──────────────────────────────────────────────────

router.get('/verify/:token', async (req, res) => {
  const { token } = req.params;

  if (!pool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const result = await pool.query(
      `SELECT ml.user_id, ml.expires_at, ml.used
       FROM magic_links ml
       WHERE ml.token = $1`,
      [token],
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired link' });
    }

    const { user_id: userId, expires_at: expiresAt, used } = result.rows[0];

    if (used) {
      return res.status(400).json({ error: 'Link already used' });
    }
    if (new Date() > new Date(expiresAt)) {
      return res.status(400).json({ error: 'Link has expired' });
    }

    // Mark as used
    const updateResult = await pool.query(
      'UPDATE magic_links SET used = true WHERE token = $1 RETURNING device_id, user_id',
      [token],
    );
    const { device_id: deviceId } = updateResult.rows[0] ?? {};

    const sessionToken = await createSession(userId);

    // Auto-create an API key and store it for device polling (if deviceId present)
    if (deviceId) {
      try {
        const { raw, hash, prefix } = generateApiKey();
        await pool.query(
          `INSERT INTO api_keys (user_id, key_hash, key_prefix, label)
           VALUES ($1, $2, $3, $4)`,
          [userId, hash, prefix, 'Extension'],
        );
        const planResult = await pool.query('SELECT plan, email FROM users WHERE id = $1', [userId]);
        const { plan, email } = planResult.rows[0] ?? { plan: 'free' };
        await storeDeviceVerification(deviceId, { apiKey: raw, plan, email });
      } catch (err) {
        console.error('[auth] Failed to auto-create key for device poll:', err.message);
      }
    }

    // Redirect to confirmation page (or return JSON in dev mode)
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      return res.redirect(`${appUrl}/verified`);
    }
    return res.json({ success: true, sessionToken });
  } catch (err) {
    console.error('[auth] verify error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

router.get('/me', requireSession, async (req, res) => {
  if (!pool) {
    return res.json({ id: req.userId, plan: req.userPlan, email: 'dev@local' });
  }

  try {
    const [userResult, keysResult, usageResult] = await Promise.all([
      pool.query('SELECT id, email, plan, created_at FROM users WHERE id = $1', [req.userId]),
      pool.query(
        'SELECT id, key_prefix, label, created_at, last_used_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC',
        [req.userId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS picks_today
         FROM picks
         WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
        [req.userId],
      ),
    ]);

    const user = userResult.rows[0];
    const planDef = PLANS[user.plan] ?? PLANS.free;

    return res.json({
      id: user.id,
      email: user.email,
      plan: user.plan,
      createdAt: user.created_at,
      picksToday: usageResult.rows[0].picks_today,
      picksPerDay: planDef.picksPerDay === Infinity ? null : planDef.picksPerDay,
      apiKeys: keysResult.rows,
    });
  } catch (err) {
    console.error('[auth] /me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/keys ─────────────────────────────────────────────────────────

router.post('/keys', requireSession, async (req, res) => {
  const { label } = req.body ?? {};

  if (!pool) {
    return res.status(503).json({ error: 'Database not available in dev mode' });
  }

  try {
    const { raw, hash, prefix } = generateApiKey();

    await pool.query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, label)
       VALUES ($1, $2, $3, $4)`,
      [req.userId, hash, prefix, label ?? null],
    );

    // Return raw key once — it can never be retrieved again
    return res.status(201).json({ key: raw, prefix, label: label ?? null });
  } catch (err) {
    console.error('[auth] create key error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /auth/keys/:id ────────────────────────────────────────────────────

router.delete('/keys/:id', requireSession, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'Database not available in dev mode' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] delete key error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /auth/poll/:deviceId ─────────────────────────────────────────────────
// Extension polls this after sending a magic link. Returns the API key once
// the user clicks the email link. The key is consumed on first successful poll.

router.get('/poll/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

  try {
    // 1. Check Redis (non-destructive — TTL handles cleanup)
    const verified = await claimDeviceVerification(deviceId);
    if (verified) {
      return res.json({ status: 'verified', apiKey: verified.apiKey, plan: verified.plan, email: verified.email });
    }

    if (!pool) return res.json({ status: 'pending' });

    // 2. Look up the magic link for this device
    const result = await pool.query(
      `SELECT ml.expires_at, ml.used, ml.user_id, u.email, u.plan
       FROM magic_links ml
       JOIN users u ON u.id = ml.user_id
       WHERE ml.device_id = $1
       ORDER BY ml.expires_at DESC LIMIT 1`,
      [deviceId],
    );

    if (result.rows.length === 0) return res.json({ status: 'expired' });

    const { expires_at, used, user_id, email, plan } = result.rows[0];

    // 3. Link was clicked but Redis entry is missing (Redis write failed in verify route)
    //    Regenerate an API key and store it so subsequent polls succeed.
    if (used) {
      try {
        const { raw, hash, prefix } = generateApiKey();
        await pool.query(
          `INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES ($1, $2, $3, $4)`,
          [user_id, hash, prefix, 'Extension'],
        );
        // Cache in Redis so this branch only runs once
        await storeDeviceVerification(deviceId, { apiKey: raw, plan, email });
        return res.json({ status: 'verified', apiKey: raw, plan, email });
      } catch (err) {
        console.error('[auth] poll fallback key creation failed:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    // 4. Link not yet clicked
    if (new Date() > new Date(expires_at)) return res.json({ status: 'expired' });
    return res.json({ status: 'pending' });

  } catch (err) {
    console.error('[auth] poll error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /auth/info ───────────────────────────────────────────────────────────
// Returns email + plan for a valid API key. Used by the extension sidebar.

router.get('/info', requireApiKey, async (req, res) => {
  if (!pool) {
    return res.json({ email: null, plan: 'pro' });
  }
  try {
    const result = await pool.query(
      'SELECT email, plan FROM users WHERE id = $1',
      [req.userId],
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ email: user.email, plan: user.plan });
  } catch (err) {
    console.error('[auth] /info error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /auth/webhook (Dodo Payments) ───────────────────────────────────────

router.post('/webhook', async (req, res) => {
  if (!process.env.DODO_WEBHOOK_KEY || !process.env.DODO_API_KEY) {
    console.warn('[auth] Dodo Payments not configured — ignoring webhook');
    return res.json({ received: true });
  }

  let event;
  try {
    const { default: DodoPayments } = await import('dodopayments');
    const dodo = new DodoPayments({
      bearerToken: process.env.DODO_API_KEY,
      webhookKey: process.env.DODO_WEBHOOK_KEY,
      environment: process.env.DODO_ENV ?? 'live_mode',
    });

    // unwrap() verifies the HMAC signature and returns the parsed event
    event = dodo.webhooks.unwrap(
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      {
        'webhook-id': req.headers['webhook-id'],
        'webhook-signature': req.headers['webhook-signature'],
        'webhook-timestamp': req.headers['webhook-timestamp'],
      },
    );
  } catch (err) {
    console.error('[auth] Dodo webhook signature error:', err.message);
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  if (!pool) {
    console.warn('[auth] Dodo webhook received but no database — ignoring');
    return res.json({ received: true });
  }

  try {
    const data = event.data;
    const customerId = data.customer?.customer_id ?? data.customer_id;
    const productId = data.product_id ?? data.items?.[0]?.product_id;

    switch (event.type) {
      case 'payment.succeeded': {
        const plan = productIdToPlan(productId) ?? 'pro';
        const email = data.customer?.email ?? null;
        await pool.query(
          `UPDATE users SET plan = $1, dodo_customer_id = $2
           WHERE dodo_customer_id = $2 OR (dodo_customer_id IS NULL AND email = $3)`,
          [plan, customerId, email],
        );
        console.log(`[auth] Pro activated via one-time payment for ${email}`);
        break;
      }

      case 'payment.failed': {
        console.warn(`[auth] Payment failed for Dodo customer ${customerId}`);
        break;
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[auth] Webhook processing error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /billing/checkout ───────────────────────────────────────────────────

router.post('/checkout', async (req, res) => {
  const collectionId = process.env.DODO_COLLECTION_PRO;
  if (!collectionId) {
    return res.status(503).json({ error: 'Pro product not configured' });
  }

  if (!process.env.DODO_API_KEY) {
    return res.status(503).json({ error: 'Dodo Payments not configured' });
  }

  try {
    const { default: DodoPayments } = await import('dodopayments');
    const dodo = new DodoPayments({
      bearerToken: process.env.DODO_API_KEY,
      environment: process.env.DODO_ENV ?? 'live_mode',
    });

    const appUrl = process.env.APP_URL ?? 'http://localhost:3001';

    // Resolve user — prefer API key auth, fall back to email in body (website flow)
    let userEmail = null;
    let dodoCustomerId = null;

    const rawKey = req.headers['x-api-key'] ||
      (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : null);

    if (rawKey && pool) {
      const { hashKey } = await import('../lib/auth.js');
      const result = await pool.query(
        `SELECT u.email, u.dodo_customer_id
         FROM api_keys ak JOIN users u ON u.id = ak.user_id
         WHERE ak.key_hash = $1`,
        [hashKey(rawKey)],
      );
      userEmail = result.rows[0]?.email ?? null;
      dodoCustomerId = result.rows[0]?.dodo_customer_id ?? null;
    }

    if (!userEmail) {
      userEmail = req.body?.email?.toLowerCase().trim() ?? null;
      if (!userEmail || !isValidEmail(userEmail)) {
        return res.status(400).json({ error: 'Valid email is required' });
      }
      if (pool) {
        const result = await pool.query(
          'SELECT dodo_customer_id FROM users WHERE email = $1',
          [userEmail],
        );
        dodoCustomerId = result.rows[0]?.dodo_customer_id ?? null;
      }
    }

    const customer = dodoCustomerId
      ? { customer_id: dodoCustomerId }
      : { email: userEmail, name: userEmail.split('@')[0] ?? 'User', create_new_customer: false };

    const session = await dodo.checkoutSessions.create({
      product_collection_id: collectionId,
      product_cart: [],
      customer,
      return_url: `${appUrl}/verified?checkout=success`,
    });

    return res.json({ url: session.checkout_url });
  } catch (err) {
    console.error('[billing] checkout error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /billing/portal ──────────────────────────────────────────────────────
// Dodo Payments doesn't have a self-serve portal yet.
// Returns the customer's Dodo ID so the frontend can surface a "contact us" flow.

router.get('/portal', requireSession, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const result = await pool.query(
      'SELECT dodo_customer_id, plan FROM users WHERE id = $1',
      [req.userId],
    );
    const { dodo_customer_id: customerId, plan } = result.rows[0] ?? {};

    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    return res.json({
      customerId,
      plan,
      manageUrl: 'mailto:hello@claspit.dev?subject=Manage%20Subscription',
    });
  } catch (err) {
    console.error('[billing] portal error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function productIdToPlan(productId) {
  if (
    productId === process.env.DODO_PRODUCT_PRO_MONTHLY ||
    productId === process.env.DODO_PRODUCT_PRO_ANNUAL
  ) return 'pro';
  return null;
}

export default router;
