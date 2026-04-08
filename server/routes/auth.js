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
import { storeDeviceVerification, claimDeviceVerification, hasDeviceVerification, storePendingApiKey, getPendingApiKey } from '../lib/storage.js';

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

// ─── Email helpers ────────────────────────────────────────────────────────────

async function sendWelcomeEmail(email, apiKey) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[auth] Welcome email for ${email} (dev mode — not sent)`);
    return;
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:3001';
  const mcpCmd = `claude mcp add --scope user --transport http clasp-it ${appUrl}/mcp --header "Authorization: Bearer ${apiKey}"`;

  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'Clasp It <hello@claspit.dev>',
    to: email,
    subject: 'You\'re all set — connect Clasp-it to your editor',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#141413;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid rgba(31,30,29,0.1);overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:#c6613f;padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Clasp-it</p>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Pick any element. Fix it with AI.</p>
        </td></tr>

        <!-- Intro -->
        <tr><td style="padding:32px 32px 0;">
          <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#141413;">The extension is ready — one step left.</p>
          <p style="margin:0;font-size:14px;color:#73726c;line-height:1.6;">
            Your Clasp-it account is verified and your API key is already loaded in the extension. Run the command below once to connect it to your AI editor.
          </p>
        </td></tr>

        <!-- API Key -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#73726c;text-transform:uppercase;letter-spacing:0.05em;">Your API Key — keep this safe</p>
          <div style="background:#f5f4ed;border:1px solid rgba(31,30,29,0.12);border-radius:8px;padding:14px 16px;">
            <p style="margin:0;font-family:'SF Mono',Consolas,monospace;font-size:13px;color:#141413;word-break:break-all;">${apiKey}</p>
          </div>
          <p style="margin:8px 0 0;font-size:12px;color:#73726c;">It's already saved in the extension. Store it somewhere safe in case you need it for another editor.</p>
        </td></tr>

        <!-- MCP command -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#141413;">Connect your AI editor (run once)</p>
          <p style="margin:0 0 12px;font-size:14px;color:#73726c;line-height:1.6;">
            Run this in your terminal — your API key is already filled in:
          </p>
          <div style="background:#f5f4ed;border:1px solid rgba(31,30,29,0.12);border-radius:8px;padding:14px 16px;overflow:hidden;">
            <p style="margin:0;font-family:'SF Mono',Consolas,monospace;font-size:11px;color:#141413;word-break:break-all;line-height:1.6;">${mcpCmd}</p>
          </div>
          <p style="margin:8px 0 0;font-size:12px;color:#73726c;">After running this, restart your editor. Setup instructions for Cursor and Windsurf are in the extension settings.</p>
        </td></tr>

        <!-- Quick start -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#141413;">Pick your first element</p>
          <ol style="margin:0;padding-left:20px;font-size:14px;color:#73726c;line-height:2;">
            <li>Open any webpage in Chrome</li>
            <li>Click the Clasp-it icon → click <strong style="color:#141413;">Pick Element</strong></li>
            <li>Click any element on the page, type your instruction, hit Send</li>
            <li>Switch to your AI editor and say: <strong style="color:#141413;">"fix all recent picks using clasp-it"</strong></li>
          </ol>
        </td></tr>

        <!-- Support -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0;font-size:14px;color:#73726c;line-height:1.6;">
            Something not working? Just reply to this email. Feedback is very welcome too — your input shapes what gets built next.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 32px 32px;">
          <p style="margin:0;font-size:12px;color:rgba(115,114,108,0.6);">© 2026 Clasp-it · <a href="${appUrl}" style="color:rgba(115,114,108,0.6);">claspit.dev</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

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
        const keyPayload = { apiKey: raw, plan, email };
        await storeDeviceVerification(deviceId, keyPayload);
        // Also cache by userId so the poll fallback can retrieve it without creating a new key
        await storePendingApiKey(userId, keyPayload);
        sendWelcomeEmail(email, raw).catch(err =>
          console.error('[auth] Failed to send welcome email:', err.message),
        );
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

    // 3. Link was clicked but Redis device entry is missing (e.g. transient Redis blip).
    //    Check the user-keyed pending cache first before creating a new DB key.
    if (used) {
      try {
        // Check user-keyed cache — avoids creating a duplicate DB entry on each poll
        const pending = await getPendingApiKey(user_id);
        if (pending) {
          // Re-populate device cache so future polls skip this branch
          await storeDeviceVerification(deviceId, pending);
          return res.json({ status: 'verified', apiKey: pending.apiKey, plan: pending.plan, email: pending.email });
        }

        // No cached key found — create a new one (last resort, should be rare)
        const { raw, hash, prefix } = generateApiKey();
        await pool.query(
          `INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES ($1, $2, $3, $4)`,
          [user_id, hash, prefix, 'Extension'],
        );
        const newPayload = { apiKey: raw, plan, email };
        await storeDeviceVerification(deviceId, newPayload);
        await storePendingApiKey(user_id, newPayload);
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

    // unwrap() verifies the HMAC signature against the raw request bytes.
    // express.raw() is registered for this route in index.js so req.body is a Buffer.
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : JSON.stringify(req.body); // fallback — should not occur in production
    event = dodo.webhooks.unwrap(
      rawBody,
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
      // Subscription created and active (monthly/annual)
      case 'subscription.active': {
        const email = data.customer?.email ?? null;
        await pool.query(
          `UPDATE users SET plan = 'pro', dodo_customer_id = $1
           WHERE dodo_customer_id = $1 OR (dodo_customer_id IS NULL AND email = $2)`,
          [customerId, email],
        );
        console.log(`[auth] Pro activated via subscription for ${email}`);
        break;
      }

      // One-time payment fallback (keep for safety)
      case 'payment.succeeded': {
        const plan = productIdToPlan(productId) ?? 'pro';
        const email = data.customer?.email ?? null;
        await pool.query(
          `UPDATE users SET plan = $1, dodo_customer_id = $2
           WHERE dodo_customer_id = $2 OR (dodo_customer_id IS NULL AND email = $3)`,
          [plan, customerId, email],
        );
        console.log(`[auth] Pro activated via payment for ${email}`);
        break;
      }

      // Subscription renewed — keep pro active
      case 'subscription.renewed': {
        const email = data.customer?.email ?? null;
        await pool.query(
          `UPDATE users SET plan = 'pro', dodo_customer_id = $1
           WHERE dodo_customer_id = $1 OR (dodo_customer_id IS NULL AND email = $2)`,
          [customerId, email],
        );
        console.log(`[auth] Pro renewed for Dodo customer ${customerId}`);
        break;
      }

      // Plan changed (e.g. monthly ↔ annual) — keep pro
      case 'subscription.plan_changed': {
        const email = data.customer?.email ?? null;
        await pool.query(
          `UPDATE users SET plan = 'pro', dodo_customer_id = $1
           WHERE dodo_customer_id = $1 OR (dodo_customer_id IS NULL AND email = $2)`,
          [customerId, email],
        );
        console.log(`[auth] Plan changed, kept Pro for Dodo customer ${customerId}`);
        break;
      }

      // Subscription ended — downgrade to free
      case 'subscription.cancelled':
      case 'subscription.expired':
      case 'subscription.failed':
      case 'subscription.on_hold': {
        const email = data.customer?.email ?? null;
        await pool.query(
          `UPDATE users SET plan = 'free'
           WHERE dodo_customer_id = $1 OR (dodo_customer_id IS NULL AND email = $2)`,
          [customerId, email],
        );
        console.log(`[auth] Plan downgraded to free on ${event.type} for Dodo customer ${customerId}`);
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
