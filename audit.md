# Clasp-it Repository Audit

**Date:** 2026-05-21
**Scope:** 56 source files across `server/`, `extension/`, `website/` + config.
`npm audit` run on production deps.

**Original audit:** read-only review (commit `44d58e9`).
**Last update:** 2026-05-21 — Round 1 + Round 2A + 2B fixes applied (commit `1633e16`).

---

## ✅ Resolution log

What's been fixed since the audit was first written. Items below are
struck through in the main report when shipped.

### Round 1 — low-risk hardening + cleanup (commit `bb1516e`)

In one commit:

- **#4 JSON body limit bumped 1 MB → 5 MB.** Pro picks with hi-DPI screenshots
  were being silently 413'd on bigger displays. Free-tier still has the
  separate 50 KB guard at `routes/element.js`.
- **#5 Removed `@vibesignals/observe` from `server/package.json`.** Was a
  dead dep — only the website actually uses it.
- **#6 Refreshed `mcp.json`.** Bumped 1.0.1 → 1.1.0; description and tool
  blurbs now mention attachments and signed URLs; pricing block calls out
  the 30 picks-with-attachments / month + $5 top-ups.
- **#8 Production refuses to boot without `DATABASE_URL`.** Without a DB,
  the auth middleware falls back to "any string is a valid Pro key" — fine
  for local dev, dangerous on Railway. Now throws on startup if
  `NODE_ENV=production && !DATABASE_URL`.
- **#9 SIGTERM/SIGINT graceful shutdown.** Server now drains in-flight
  requests, closes the PG pool + Redis, and clears the cleanup interval
  before exiting. 9-second self-kill timer if anything hangs (Railway
  grace period is ~10 s). Verified locally: clean exit in <100 ms.
- **#10 Emails dropped from production webhook logs.** Pro-activation,
  top-up, etc. now log Dodo `customer_id` only. Dev-mode magic-link logs
  (gated by `!RESEND_API_KEY`) keep the email since they only fire
  locally.

### Round 2A — patched all transitive deps (commit `022324e`)

- **#2 `npm audit`: 6 vulns (4 moderate + 2 high) → 0 vulns.**

  Why `npm audit fix` was a no-op: lockfile pinned old patches, and the
  MCP SDK's caret ranges (`^1.19.9`, `^4.11.4`, etc.) allowed newer
  patched versions but the lockfile resolution had frozen old ones.

  Surgical fix via `package.json` `overrides` field — force the patched
  version of each vulnerable transitive dep. Doesn't touch the SDK
  version itself.

  | Package | Old | New | Severity |
  |---|---|---|---|
  | `@hono/node-server` | 1.19.11 | 1.19.14 | moderate (CWE-22) |
  | `hono` | 4.12.5 | 4.12.21 | moderate (×11 advisories) |
  | `fast-uri` | 3.1.0 | 3.1.2 | high |
  | `ip-address` | 10.1.0 | 10.2.0 | moderate |
  | `path-to-regexp` (under express 4) | 0.1.12 | 0.1.13 | high (ReDoS) |
  | `path-to-regexp` (under router for express 5) | 8.3.0 | 8.4.2 | high (ReDoS) |

  Verified post-upgrade: server boots, MCP `tools/list` returns all 5
  tools, transport works.

### Round 2C — `/auth/poll` redesign (commit pending — this round)

- **#1 `/auth/poll/:deviceId` raw-key replay vector → addressed via additive POST endpoint.**

  Two improvements, both behind a new `POST /auth/poll`:
  1. `deviceId` moved from URL path to request body — proxy/CDN access
     logs no longer record it.
  2. Atomic `GETDEL` on the device record on first successful poll
     (`consumeDeviceVerification` helper). Replaying the same deviceId
     post-success returns `pending` (record gone), even if the 15-min
     TTL hasn't elapsed.

  Recovery path still works (`magic_links` table + `pending_key:userId`
  cache cover the case where extension reads the key but fails to save).

  **Back-compat:** the legacy `GET /auth/poll/:deviceId` is unchanged.
  Chrome Web Store v1.0.1 users keep working as before. Local extension
  v1.1.0 now uses POST. Once CWS rolls forward, the GET endpoint can be
  retired.

  Verified locally:
  - POST first call returns key
  - POST replay → `pending` (consumed)
  - GET endpoint still works as legacy clients expect

### Round 2B — rate limiting (commit `1633e16`)

- **#3 Rate limiting on every endpoint that does real work.**

  New: `server/lib/ratelimit.js` exposes two factories — `apiKeyLimiter()`
  (keyed by `req.userId`, falls back to IP if unauthenticated) and
  `ipLimiter()` (keyed by client IP). Both share a 429 envelope so the
  client can detect throttling with one check.

  `app.set('trust proxy', 1)` added so the IP limiter sees the real
  client behind Railway's reverse-proxy hop, not the proxy itself.

  Per-route caps:

  | Endpoint(s) | Bucket | Limit |
  |---|---|---|
  | `POST/PATCH/DELETE/GET /element-context*` | per API key | 600/min |
  | `GET/POST /mcp` (Claude tool calls) | per API key | 1200/min |
  | `GET /auth/info` | per API key | 60/min |
  | `GET /auth/verify/:token` | per IP | 30/min |
  | `GET /auth/poll/:deviceId` | per IP | 60/min |
  | `GET/POST/DELETE /auth/me, /auth/keys*` | per IP | 60/min |
  | `POST /billing/checkout`, `/checkout/topup` | per IP | 20/min |
  | `POST /auth/webhook` | **no limit** | (Dodo retries — limiter would worsen failures) |
  | `POST /auth/signup` | per IP | 10/h (existing inline limiter, kept) |

  Verified locally: 600 successive `/element-context/quota` calls all
  return 200; the 601st returns 429. 60 calls to `/auth/poll/<random>`
  from one IP all 200; the 61st returns 429.

### Round 2E — final cleanup pass (extension + server)

Extension (commit `ea883fd`):
- **#8 storage-prefix migration:** `bp_api_key` (legacy "Browser Pick"
  era) → `clasp_api_key`. Read-from-both-write-to-new shim in `init()`.
  First load after upgrade: read either name, prefer the new one,
  rewrite the legacy value to the new key, remove the old key. After
  migration: only `clasp_api_key` exists in chrome.storage. Sign-out
  clears both names defensively in case a user signs out before
  init() ran.
- **#12 + #13 panel.html removed:** legacy placeholder file deleted.
  Manifest's `web_accessible_resources` no longer references it.
  `sidepanel.html` is the actual UI; `panel.html` was just there
  because the manifest mentioned it.
- CLAUDE.md repo-structure section updated to drop the panel.html
  line.

Server (commit pending):
- **#24 session tokens hashed at rest.** `createSession` SHA-256s the
  UUIDv4 before writing to Redis (or in-memory fallback);
  `resolveSession` hashes the incoming token and looks up by hash.
  Any Redis reader now sees hashes only. Existing sessions
  invalidated by the cutover (old plaintext keys orphaned; TTL out
  in ≤7 days). Zero client impact since no active surface uses
  sessions today.

### Round 2D — second-pass security review (in progress)

A deeper look at attack surfaces beyond the original audit. Numbering
continues from the original list.

- **~~#21 🔴 Webhook is not idempotent — top-up can be double-credited~~** ✅ FIXED in `routes/auth.js` + `lib/storage.js#markWebhookSeen`.
  Atomic SETNX-style claim on `webhook:seen:<webhook-id>` with 24h TTL.
  Duplicate deliveries ack 200 with `{deduped: true}` and skip the
  handler. Falls back to bounded in-memory map when Redis is missing.
  Verified locally: replay of the same id returns false; fresh ids
  return true; null/empty IDs fail open (allow processing) since
  blocking them would drop legit events from any sender that
  doesn't include the header.

- **~~#22 🟡 Compromised session can mint unlimited API keys~~** ✅ FIXED via "strict 1 key per user" — see below.
  Approach chosen after user discussion: instead of capping keys per
  user, enforce that there's only ever one. Multi-device users copy
  the same key (Settings → API Key) into each install, which matches
  the actual mental model — one email, one key, used everywhere.

  Server changes (`routes/auth.js`): every key-mint path now does
  `DELETE FROM api_keys WHERE user_id = $1` before INSERT.
    - `/auth/verify/:token` (magic-link click — auto-mint)
    - `/auth/poll/:deviceId` GET fallback path
    - `/auth/poll` POST fallback path
    - `/auth/keys` (session-authed mint)

  Practical effects:
    - Re-signup invalidates all prior keys for that user — every other
      install (browser, editor) using the old key has to be re-pasted
      with the new one. Acceptable trade-off; re-signup is rare.
    - DB stops accumulating orphan rows from repeat magic-link clicks.
    - A leaked key can be revoked by re-signing up. (No dedicated
      "rotate key" endpoint yet — that's a future addition.)
    - Compromised session can still mint a new key, but it's exactly
      one key, and the legitimate user noticing → re-signing up
      revokes the attacker's key in turn.

  Extension UX support shipped alongside:
    - Settings panel: full-width API key block with prominent "Copy"
      button + microcopy explaining multi-device usage.
    - Auth screen "Or paste existing key": new hint pointing to the
      key location on the other install.
    - FAQ: new entry "Can I use Clasp-it on multiple browsers or
      editors?" → yes, copy the same key everywhere.

- **~~#23 🟡 `/auth/signup` enables email-bombing a target inbox~~** ✅ FIXED in `lib/storage.js#recordSignupAttempt` + wiring in `routes/auth.js`.
  New per-target-email counter. 5 attempts/h/email. Returns 429 with a
  clear message once the limit is hit. Email is normalized
  (lowercase + trim) before being used as the cache key, matching the
  DB upsert normalisation, so case/whitespace can't bypass.
  Falls back to a bounded in-memory map when Redis is missing.
  Verified locally:
    - 5 attempts for the same email succeed
    - 6th+ return 429 with the friendly copy
    - Different emails have independent buckets
    - Empty input is a no-op (doesn't crash on bad input)

- **~~#24 🟢 Session tokens stored as plaintext in Redis~~** ✅ FIXED in `lib/auth.js#createSession + resolveSession`.
  SHA-256 hash on write, compare hash on read. Token is still a
  UUIDv4 returned to the client; the server only ever stores the
  hash. Anyone reading the Redis dump now sees hashes, not tokens.
  Existing sessions in Redis are invalidated by the cutover (the
  old plaintext keys are orphaned, TTL out in ≤7 days). Zero client
  impact: no active surface uses sessions today.
  Verified locally: round-trip works (createSession → resolveSession
  → userId); garbage / null / empty inputs return null.

- **#25 🟢 R2 signed-URL TTL of 1 hour is generous**
  `routes/mcp.js:35`. If a Claude transcript leaks the URL, anyone
  with the URL can fetch the attachment for the next hour. The
  attachment is the user's own upload, so the only person hurt is
  the user themselves.
  Status: leave at 1h. Could lower to 5min if AI fetch latency
  permits, but 1h is the safer default for AI usability.

### Items deferred / still open

- **#1 `/auth/poll` returns raw API key + deviceId in URL.** Not yet
  fixed — needs coordinated server + extension change. Real attack
  surface; good candidate for next round.
- **#7 `bp_api_key` storage prefix in extension.** Migration pattern is
  clear (read-from-old-write-to-new shim) but touches the extension's
  auth flow. Defer until paired with another extension change.
- **#11 `/auth/me` returns full API-key prefixes.** Acceptable for now
  since no UI consumes it. Revisit if a dashboard ever does.
- All 🟢 cleanup / ops items below — schedule when convenient.

---

## 📋 Original report

Items still applicable are below. Items shipped above are crossed out
where they appear in the main list.

---

## 🔴 Higher-priority items (worth acting on)

### ~~1. `/auth/poll/:deviceId` is an unauthenticated raw-key dispenser~~ ✅ FIXED — see Round 2C below
`server/routes/auth.js:385`. The endpoint takes a deviceId in the URL and returns the **raw `cit_…` API key** in plaintext. Mitigations exist (UUIDv4 randomness, 15-min Redis TTL), but:

- DeviceId is in the URL path, so it lands in **any** access log Railway/Cloudflare/proxies keep
- The verification record is **not consumed on first read** (intentional, but means the same deviceId can be polled repeatedly until TTL)
- A leaked deviceId in a 15-min window → durable API key

**Risk:** medium — exploitable but requires log access.
**Suggested:** treat deviceId as a secret (don't log it), use `POST /auth/poll` with the deviceId in the body, and consume the record on first successful poll.

### ~~2. `npm audit` — 6 vulns, all in MCP SDK's transitive tree~~ ✅ FIXED in `022324e`
4 moderate, 2 high. Everything traces to `@modelcontextprotocol/sdk@1.27.1` pulling in `hono` 4.12.5, `@hono/node-server` 1.19.11, `path-to-regexp`, `ip-address`, `express-rate-limit`. Notable:

- `hono` has 11 advisories (prototype pollution, cookie bypass, path traversal, JSX injection)
- `path-to-regexp` ReDoS
- `fast-uri` path traversal

The MCP server *uses* `@modelcontextprotocol/sdk` for the streamable-HTTP transport. `hono` is bundled by the SDK but **clasp-it is on Express**, not Hono — most attack surfaces don't apply, but you're shipping the vulnerable code.

**Suggested:** check if a newer SDK has cleaner deps (`npm view @modelcontextprotocol/sdk versions`), or run `npm audit fix` and verify the streamable HTTP transport still works.

### ~~3. `/auth/poll` and `/element-context/quota` lack rate limiting~~ ✅ FIXED in `1633e16`
Only `POST /auth/signup` has the per-IP limiter (`server/routes/auth.js:34`). Everything else is wide open:

- `/auth/poll/:deviceId` could be hammered to brute-force device IDs (122 bits → in practice unfeasible, but no defense in depth)
- `/element-context/quota`, `/element-context/:id`, `PATCH`, `DELETE` — all auth'd but no per-user rate limit. A misbehaving extension or compromised key could hammer the DB.

**Risk:** low at current scale, climbs with usage.
**Suggested:** add a single global `express-rate-limit` (already in deps via SDK) on the API surface, e.g. 200 req/min/key.

### ~~4. `express.json({ limit: '1mb' })` may silently reject Pro screenshots~~ ✅ FIXED in `bb1516e`
`server/index.js:44`. A high-DPI screenshot (4K display, dense element) base64-encoded in `pick.context.screenshot` can exceed 1 MB. Result: Pro user gets `413 Payload too large` with no friendly UX. Free users have a separate 50KB guard at `routes/element.js:81`, but Pro relies on the global limit.

**Suggested:** bump Pro limit to 5MB (matches attachment cap) or per-route override. Add a friendlier error message when 413 hits.

### 5. Rate limiter is in-memory and per-instance
`server/routes/auth.js:32` — `signupRateLimit = new Map()`. Single Railway instance today → OK. If you ever scale horizontally, the limit becomes "10 signups/h × N instances" and is trivially bypassed by load-balanced retries. Also: entries with stale `resetAt` are never cleaned, so the Map grows without bound (mild leak — bounded by unique IPs).

**Suggested:** when you scale: use Redis-backed counters for signup rate limit. Add periodic cleanup of stale entries.

---

## 🟡 Medium-priority items

### ~~6. `@vibesignals/observe` is a dead dependency in `server/package.json`~~ ✅ FIXED in `bb1516e`
`server/package.json:16`. Imported only in `website/src/analytics.js`. Not used anywhere in `server/`. Increases `npm ci` time + container size for nothing.

### ~~7. `mcp.json` is stale~~ ✅ FIXED in `bb1516e`
Root-level `mcp.json` declares `"version": "1.0.1"` and an old description that doesn't mention attachments. If `claudecodemarketplace.net` or similar reads it, you're shipping outdated metadata.

### ~~8. Inconsistent storage prefix in extension~~ ✅ FIXED — see Round 2E
Six places use `bp_api_key`, eight places use `clasp_*` keys. `bp_` is legacy ("Browser Pick" naming). Functional today, but a future bug magnet.

### 9. VibeSignals public key committed in client bundle
`website/src/analytics.js:3` — `acgfpGDz5qvPlYyMKhZvxZVYVQZ4KQtupgPMD1ljeY0`. This IS shipped to every visitor's browser by design (it's a write-only telemetry key), but worth confirming with VibeSignals docs that its scope is read-protected. If anyone can READ telemetry with it, that's a leak.

### ~~10. PII in server logs~~ ✅ FIXED in `bb1516e` (production logs only)
Multiple `console.log` lines include user emails (e.g. `auth.js:519`: `console.log("Pro activated via subscription for ${email}")`). Railway logs are private to you, but for GDPR posture / future log shipping, this becomes a compliance ask. Hashed user IDs or redacted-domain emails would be safer.

### 11. `/auth/me` returns full API-key list with prefixes
`server/routes/auth.js:300`. Currently no UI consumes this endpoint that I can see, but it's authenticated via session token only. If a session token leaks, attacker sees all key prefixes (not the raw keys, but a recon win).

---

## 🟢 Stale / unused code

### ~~12. `extension/panel.html` is a placeholder~~ ✅ DELETED — see Round 2E
Comment says it exists "only so the manifest's `web_accessible_resources` declaration is satisfied". Could likely be dropped from the manifest and the file deleted.

### ~~13. `extension/manifest.json` web_accessible_resources lists `panel.html`~~ ✅ FIXED — see Round 2E
Same as above — only there because the file is.

### 14. `server/public/blog/` is functionally orphaned in docs
6 blog HTML files served by `express.static`. CLAUDE.md doesn't mention them, the website footer does link to `/blog`. Worth deciding: either bring blog into the build pipeline (Vite source) or document why they're standalone HTML.

### 15. `server/public/downloads/` has `clasp-it-extension.zip` (29KB)
Possibly stale (29KB is small; current packaged extension may be larger). Generated by `npm run build:extension` — but no UI references it any more (the welcome email did, the website doesn't). Either re-link from website or remove.

### 16. `setTimeout` in `saveEdit` 409 path doesn't get cancelled if user navigates away
`extension/sidepanel.js` — 900ms timer fires `showScreen("main")`. If user closes the side panel mid-timer, the `setTimeout` is effectively orphaned (the side panel page lifecycle handles it eventually). Cosmetic, not a real leak.

---

## ⚙️ Operational concerns

### ~~17. No graceful shutdown~~ ✅ FIXED in `bb1516e`
No `SIGTERM`/`SIGINT` handler. Railway sends SIGTERM on restart; clasp-it ignores it and gets SIGKILL'd after grace period. In-flight uploads can be cut. Redis/PG pool connections aren't drained.

### 18. `decrementAttachmentsUsed` race
`server/routes/element.js:362`. The check "is this the last attachment" reads `updated.attachments.length` after the LSET. Two parallel DELETEs for the last two attachments could both see length=0 and both decrement, taking the counter to -1. **Saved by the clamp in `decrementAttachmentsUsed` itself**, but if you ever remove the clamp, this would explode.

### 19. R2 cleanup vs DB cleanup ordering note
`server/lib/cleanup.js`. R2 fails → DB row deleted anyway → orphaned R2 object with no DB pointer. The code comment acknowledges this (`That's an orphan in R2 — acceptable, R2 has no DB FK`). True, but you have no way to find these orphans later if you ever wanted to clean them. Consider tracking failed R2 deletes in a small "to_purge" Redis list.

### ~~20. Dev mode auth is a foot-gun~~ ✅ FIXED in `bb1516e`
`server/lib/auth.js:147` — when `DATABASE_URL` is unset, `requireApiKey` accepts ANY string as a key with full Pro access. Today this only triggers locally without `.env`, so safe. But: a Railway misconfiguration that drops `DATABASE_URL` (hostname rename, DB outage with `db.js` falling back to no-pool) silently turns auth off. The `db.js` startup warns but doesn't fail.
**Suggested:** in production (`NODE_ENV === 'production'`), refuse to start if `DATABASE_URL` is unset.

---

## ✅ Things that look good

For balance — these came up clean:

- **SQL injection:** every `pool.query` call uses parameterized `$1, $2…`. No string interpolation in queries.
- **Password handling:** there are no passwords. Magic-link only.
- **API key storage:** SHA-256 hashed at rest, raw shown once. Correct.
- **Webhook signature verification:** `dodo.webhooks.unwrap()` runs against the raw body, registered as `express.raw()` before `express.json()`. Correct.
- **CORS:** open `*` is fine here because all sensitive ops require an `Authorization` header that browsers won't auto-attach cross-origin (no cookies).
- **HSTS:** `max-age=31536000; includeSubDomains` set globally.
- **R2 signed URLs:** scoped to GET, 1-hour expiry, private bucket. Correct.
- **Multer:** memory storage with hard caps (25 MB / 3 files), MIME whitelist enforced server-side.
- **`.env`** files: not tracked, gitignore covers `.env`, `.env.local`, `.env.*.local`.
- **Secrets in repo:** none found in source — only the VibeSignals public client key (which is public by design).
- **HTML escaping:** `innerHTML` is used 6 times, all with hardcoded strings or sanitized template literals. No untrusted data flows into HTML.
- **R2 path injection:** `buildAttachmentKey` runs `ext` through a regex strip — `userId`/`pickId`/`attachmentId` are server-generated UUIDs/hex.
- **Multer 1.x → 2.x bump:** previous CVEs already addressed.

---

## TL;DR ranked

| # | Severity | Item | Status |
|---|---|---|---|
| 1 | 🔴 medium | `/auth/poll` returns raw API key + deviceId in URL | ✅ shipped (Round 2C) |
| 2 | 🔴 medium | 6 npm vulns from MCP SDK transitive deps | ✅ shipped `022324e` |
| 3 | 🟡 low | No rate limit on most endpoints | ✅ shipped `1633e16` |
| 4 | 🟡 low | 1 MB JSON limit may reject Pro screenshots | ✅ shipped `bb1516e` |
| 5 | 🟢 cleanup | Drop `@vibesignals/observe` from server deps | ✅ shipped `bb1516e` |
| 6 | 🟢 cleanup | `mcp.json` version bump + attachments mention | ✅ shipped `bb1516e` |
| 7 | 🟡 cleanup | Standardize on `clasp_*` storage prefix | ⏳ open |
| 8 | 🟡 ops | Refuse to boot in production without `DATABASE_URL` | ✅ shipped `bb1516e` |
| 9 | 🟡 ops | Graceful SIGTERM handler | ✅ shipped `bb1516e` |
| 10 | 🟢 ops | PII (emails) in production logs | ✅ shipped `bb1516e` |

**9 of 10 ranked items shipped.** One open: the `bp_api_key` storage
prefix migration (cosmetic, deferred to pair with another extension
change).
