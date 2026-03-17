/**
 * Beta signup route
 *
 * POST /beta/signup — register email, generate API key, send welcome email
 */

import { Router } from 'express';
import { pool } from '../lib/db.js';
import { generateApiKey } from '../lib/auth.js';

const router = Router();

// ─── IP rate limiter ──────────────────────────────────────────────────────────

const signupRateLimit = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = signupRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    signupRateLimit.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// ─── Email validation ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(e) {
  return typeof e === 'string' && EMAIL_RE.test(e) && e.length <= 254;
}

// ─── Welcome email ────────────────────────────────────────────────────────────

async function sendAlreadySignedUpEmail(email) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[beta] Already signed up nudge for ${email}`);
    return;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'Clasp It <hello@claspit.dev>',
    to: email,
    subject: 'You\'re already signed up for Clasp-it',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#141413;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid rgba(31,30,29,0.1);overflow:hidden;">
        <tr><td style="background:#c6613f;padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Clasp-it</p>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Pick any element. Fix it with Claude.</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#141413;">You're already signed up!</p>
          <p style="margin:0 0 16px;font-size:14px;color:#73726c;line-height:1.6;">
            Looks like you've already joined the Clasp-it beta. Your API key was sent in your original welcome email — check your inbox for an email with the subject <strong style="color:#141413;">"Your Clasp-it beta access is ready"</strong>.
          </p>
          <p style="margin:0 0 16px;font-size:14px;color:#73726c;line-height:1.6;">
            Can't find it? Check your spam folder, or just reply to this email and I'll sort it out for you.
          </p>
          <p style="margin:0;font-size:12px;color:rgba(115,114,108,0.6);">© 2026 Clasp-it · <a href="https://claspit.dev" style="color:rgba(115,114,108,0.6);">claspit.dev</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

async function sendWelcomeEmail(email, apiKey) {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3001';
  const mcpCmd = `claude mcp add --scope user --transport http clasp-it ${appUrl}/mcp --header "Authorization: Bearer ${apiKey}"`;
  const zipUrl = `${appUrl}/downloads/clasp-it-extension.zip`;
  const setupUrl = `${appUrl}/downloads/clasp-it-setup.md`;

  if (!process.env.RESEND_API_KEY) {
    console.log(`[beta] Welcome email for ${email} (dev mode — no email sent, key omitted from logs)`);
    return;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.RESEND_FROM ?? 'Clasp It <hello@claspit.dev>',
    to: email,
    subject: 'Your Clasp-it beta access is ready 🎉',
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
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Pick any element. Fix it with Claude.</p>
        </td></tr>

        <!-- Intro -->
        <tr><td style="padding:32px 32px 0;">
          <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#141413;">Welcome to the beta!</p>
          <p style="margin:0;font-size:14px;color:#73726c;line-height:1.6;">
            Thanks for joining. Clasp-it is a Chrome extension that lets you click any element on any webpage and send its full context — HTML, CSS, React props, console logs, and a screenshot — directly to your AI editor via MCP. No more copy-pasting. No more describing what you see. Just click and tell your editor what to change.
          </p>
        </td></tr>

        <!-- API Key -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#73726c;text-transform:uppercase;letter-spacing:0.05em;">Your API Key — save this</p>
          <div style="background:#f5f4ed;border:1px solid rgba(31,30,29,0.12);border-radius:8px;padding:14px 16px;">
            <p style="margin:0;font-family:'SF Mono',Consolas,monospace;font-size:13px;color:#141413;word-break:break-all;">${apiKey}</p>
          </div>
          <p style="margin:8px 0 0;font-size:12px;color:#73726c;">You'll paste this into the extension sidebar and the terminal command below.</p>
        </td></tr>

        <!-- Step 1 -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#141413;">Step 1 — Install the Chrome extension</p>
          <p style="margin:0 0 12px;font-size:14px;color:#73726c;line-height:1.6;">
            Since Clasp-it is in beta, it isn't on the Chrome Web Store yet. You'll load it manually — it takes about 60 seconds.
          </p>
          <ol style="margin:0 0 12px;padding-left:20px;font-size:14px;color:#73726c;line-height:2;">
            <li>Download the extension: <a href="${zipUrl}" style="color:#c6613f;font-weight:500;">clasp-it-extension.zip</a></li>
            <li>Unzip it to a permanent folder (don't delete it after — Chrome needs the folder)</li>
            <li>Open <strong style="color:#141413;">chrome://extensions</strong> in your browser</li>
            <li>Enable <strong style="color:#141413;">Developer mode</strong> (toggle in the top-right corner)</li>
            <li>Click <strong style="color:#141413;">Load unpacked</strong> and select the unzipped folder</li>
            <li>Pin the Clasp-it icon to your toolbar for easy access</li>
          </ol>
          <p style="margin:0;font-size:14px;color:#73726c;line-height:1.6;">
            Once installed, open the extension sidebar and paste your API key above when prompted.
          </p>
        </td></tr>

        <!-- Step 2 -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#141413;">Step 2 — Connect your AI editor (run once)</p>
          <p style="margin:0 0 12px;font-size:14px;color:#73726c;line-height:1.6;">
            This command adds Clasp-it as an MCP server so your AI editor can read your picks. Run it once in your terminal — your API key is already filled in:
          </p>
          <div style="background:#f5f4ed;border:1px solid rgba(31,30,29,0.12);border-radius:8px;padding:14px 16px;overflow:hidden;">
            <p style="margin:0;font-family:'SF Mono',Consolas,monospace;font-size:11px;color:#141413;word-break:break-all;line-height:1.6;">${mcpCmd}</p>
          </div>
          <p style="margin:8px 0 0;font-size:12px;color:#73726c;">After running this, restart your editor. Setup instructions for Cursor and Windsurf are in the extension settings.</p>
        </td></tr>

        <!-- Step 3 -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#141413;">Step 3 — Pick your first element</p>
          <ol style="margin:0;padding-left:20px;font-size:14px;color:#73726c;line-height:2;">
            <li>Open any webpage in Chrome</li>
            <li>Click the Clasp-it icon in your toolbar → click <strong style="color:#141413;">Pick Element</strong></li>
            <li>Click any element on the page</li>
            <li>Type your instruction and hit Send</li>
            <li>Switch to your AI editor and say: <strong style="color:#141413;">"fix all recent picks using clasp-it"</strong></li>
          </ol>
        </td></tr>

        <!-- Setup guide -->
        <tr><td style="padding:24px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#f5f4ed;border:1px solid rgba(31,30,29,0.1);border-radius:8px;padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#141413;">📄 Full setup guide</p>
                <p style="margin:0 0 10px;font-size:13px;color:#73726c;line-height:1.5;">Download the Markdown setup guide and drop it into your project. You can then ask Claude or any LLM questions about Clasp-it — installation, usage, troubleshooting — and it'll have everything it needs to help you.</p>
                <a href="${setupUrl}" style="color:#c6613f;font-size:13px;font-weight:500;">Download clasp-it-setup.md →</a>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Support -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0;font-size:14px;color:#73726c;line-height:1.6;">
            Something not working? Just reply to this email and I'll help you sort it out. Feedback is very welcome too — this is beta and your input shapes what gets built next.
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

// ─── POST /beta/signup ────────────────────────────────────────────────────────

router.post('/signup', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }

  const { email } = req.body ?? {};
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  if (!pool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const normalised = email.toLowerCase().trim();

  try {
    // Check if this email already signed up — if so, re-send the same key
    const existing = await pool.query(
      `SELECT ak.key_prefix, bs.email
       FROM beta_signups bs
       JOIN api_keys ak ON ak.id = bs.api_key_id
       WHERE bs.email = $1`,
      [normalised],
    );

    if (existing.rows.length > 0) {
      // Already signed up — send a nudge email, no new key created
      await sendAlreadySignedUpEmail(normalised);
      return res.json({ success: true });
    }

    // New signup — upsert user, generate key, record signup
    const userResult = await pool.query(
      `INSERT INTO users (email)
       VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [normalised],
    );
    const userId = userResult.rows[0].id;

    const { raw, hash, prefix } = generateApiKey();
    const keyResult = await pool.query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, label)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, hash, prefix, 'Beta'],
    );

    await pool.query(
      `INSERT INTO beta_signups (email, user_id, api_key_id) VALUES ($1, $2, $3)`,
      [normalised, userId, keyResult.rows[0].id],
    );

    await sendWelcomeEmail(normalised, raw);

    return res.json({ success: true });
  } catch (err) {
    console.error('[beta] signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
