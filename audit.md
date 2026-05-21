# Clasp-it Repository Audit

**Date:** 2026-05-21
**Scope:** 56 source files across `server/`, `extension/`, `website/` + config.
`npm audit` run on production deps. No fixes applied — read-only review.

---

## 🔴 Higher-priority items (worth acting on)

### 1. `/auth/poll/:deviceId` is an unauthenticated raw-key dispenser
`server/routes/auth.js:385`. The endpoint takes a deviceId in the URL and returns the **raw `cit_…` API key** in plaintext. Mitigations exist (UUIDv4 randomness, 15-min Redis TTL), but:

- DeviceId is in the URL path, so it lands in **any** access log Railway/Cloudflare/proxies keep
- The verification record is **not consumed on first read** (intentional, but means the same deviceId can be polled repeatedly until TTL)
- A leaked deviceId in a 15-min window → durable API key

**Risk:** medium — exploitable but requires log access.
**Suggested:** treat deviceId as a secret (don't log it), use `POST /auth/poll` with the deviceId in the body, and consume the record on first successful poll.

### 2. `npm audit` — 6 vulns, all in MCP SDK's transitive tree
4 moderate, 2 high. Everything traces to `@modelcontextprotocol/sdk@1.27.1` pulling in `hono` 4.12.5, `@hono/node-server` 1.19.11, `path-to-regexp`, `ip-address`, `express-rate-limit`. Notable:

- `hono` has 11 advisories (prototype pollution, cookie bypass, path traversal, JSX injection)
- `path-to-regexp` ReDoS
- `fast-uri` path traversal

The MCP server *uses* `@modelcontextprotocol/sdk` for the streamable-HTTP transport. `hono` is bundled by the SDK but **clasp-it is on Express**, not Hono — most attack surfaces don't apply, but you're shipping the vulnerable code.

**Suggested:** check if a newer SDK has cleaner deps (`npm view @modelcontextprotocol/sdk versions`), or run `npm audit fix` and verify the streamable HTTP transport still works.

### 3. `/auth/poll` and `/element-context/quota` lack rate limiting
Only `POST /auth/signup` has the per-IP limiter (`server/routes/auth.js:34`). Everything else is wide open:

- `/auth/poll/:deviceId` could be hammered to brute-force device IDs (122 bits → in practice unfeasible, but no defense in depth)
- `/element-context/quota`, `/element-context/:id`, `PATCH`, `DELETE` — all auth'd but no per-user rate limit. A misbehaving extension or compromised key could hammer the DB.

**Risk:** low at current scale, climbs with usage.
**Suggested:** add a single global `express-rate-limit` (already in deps via SDK) on the API surface, e.g. 200 req/min/key.

### 4. `express.json({ limit: '1mb' })` may silently reject Pro screenshots
`server/index.js:44`. A high-DPI screenshot (4K display, dense element) base64-encoded in `pick.context.screenshot` can exceed 1 MB. Result: Pro user gets `413 Payload too large` with no friendly UX. Free users have a separate 50KB guard at `routes/element.js:81`, but Pro relies on the global limit.

**Suggested:** bump Pro limit to 5MB (matches attachment cap) or per-route override. Add a friendlier error message when 413 hits.

### 5. Rate limiter is in-memory and per-instance
`server/routes/auth.js:32` — `signupRateLimit = new Map()`. Single Railway instance today → OK. If you ever scale horizontally, the limit becomes "10 signups/h × N instances" and is trivially bypassed by load-balanced retries. Also: entries with stale `resetAt` are never cleaned, so the Map grows without bound (mild leak — bounded by unique IPs).

**Suggested:** when you scale: use Redis-backed counters for signup rate limit. Add periodic cleanup of stale entries.

---

## 🟡 Medium-priority items

### 6. `@vibesignals/observe` is a dead dependency in `server/package.json`
`server/package.json:16`. Imported only in `website/src/analytics.js`. Not used anywhere in `server/`. Increases `npm ci` time + container size for nothing.

### 7. `mcp.json` is stale
Root-level `mcp.json` declares `"version": "1.0.1"` and an old description that doesn't mention attachments. If `claudecodemarketplace.net` or similar reads it, you're shipping outdated metadata.

### 8. Inconsistent storage prefix in extension
Six places use `bp_api_key`, eight places use `clasp_*` keys. `bp_` is legacy ("Browser Pick" naming). Functional today, but a future bug magnet.

### 9. VibeSignals public key committed in client bundle
`website/src/analytics.js:3` — `acgfpGDz5qvPlYyMKhZvxZVYVQZ4KQtupgPMD1ljeY0`. This IS shipped to every visitor's browser by design (it's a write-only telemetry key), but worth confirming with VibeSignals docs that its scope is read-protected. If anyone can READ telemetry with it, that's a leak.

### 10. PII in server logs
Multiple `console.log` lines include user emails (e.g. `auth.js:519`: `console.log("Pro activated via subscription for ${email}")`). Railway logs are private to you, but for GDPR posture / future log shipping, this becomes a compliance ask. Hashed user IDs or redacted-domain emails would be safer.

### 11. `/auth/me` returns full API-key list with prefixes
`server/routes/auth.js:300`. Currently no UI consumes this endpoint that I can see, but it's authenticated via session token only. If a session token leaks, attacker sees all key prefixes (not the raw keys, but a recon win).

---

## 🟢 Stale / unused code

### 12. `extension/panel.html` is a placeholder
Comment says it exists "only so the manifest's `web_accessible_resources` declaration is satisfied". Could likely be dropped from the manifest and the file deleted.

### 13. `extension/manifest.json` web_accessible_resources lists `panel.html`
Same as above — only there because the file is.

### 14. `server/public/blog/` is functionally orphaned in docs
6 blog HTML files served by `express.static`. CLAUDE.md doesn't mention them, the website footer does link to `/blog`. Worth deciding: either bring blog into the build pipeline (Vite source) or document why they're standalone HTML.

### 15. `server/public/downloads/` has `clasp-it-extension.zip` (29KB)
Possibly stale (29KB is small; current packaged extension may be larger). Generated by `npm run build:extension` — but no UI references it any more (the welcome email did, the website doesn't). Either re-link from website or remove.

### 16. `setTimeout` in `saveEdit` 409 path doesn't get cancelled if user navigates away
`extension/sidepanel.js` — 900ms timer fires `showScreen("main")`. If user closes the side panel mid-timer, the `setTimeout` is effectively orphaned (the side panel page lifecycle handles it eventually). Cosmetic, not a real leak.

---

## ⚙️ Operational concerns

### 17. No graceful shutdown
No `SIGTERM`/`SIGINT` handler. Railway sends SIGTERM on restart; clasp-it ignores it and gets SIGKILL'd after grace period. In-flight uploads can be cut. Redis/PG pool connections aren't drained.

### 18. `decrementAttachmentsUsed` race
`server/routes/element.js:362`. The check "is this the last attachment" reads `updated.attachments.length` after the LSET. Two parallel DELETEs for the last two attachments could both see length=0 and both decrement, taking the counter to -1. **Saved by the clamp in `decrementAttachmentsUsed` itself**, but if you ever remove the clamp, this would explode.

### 19. R2 cleanup vs DB cleanup ordering note
`server/lib/cleanup.js`. R2 fails → DB row deleted anyway → orphaned R2 object with no DB pointer. The code comment acknowledges this (`That's an orphan in R2 — acceptable, R2 has no DB FK`). True, but you have no way to find these orphans later if you ever wanted to clean them. Consider tracking failed R2 deletes in a small "to_purge" Redis list.

### 20. Dev mode auth is a foot-gun
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

| # | Severity | Item | Effort |
|---|---|---|---|
| 1 | 🔴 medium | `/auth/poll` returns raw API key + deviceId in URL | M |
| 2 | 🔴 medium | 6 npm vulns from MCP SDK transitive deps | S — try `npm audit fix` |
| 3 | 🟡 low | No rate limit on most endpoints | S — global middleware |
| 4 | 🟡 low | 1 MB JSON limit may reject Pro screenshots | XS — bump to 5 MB |
| 5 | 🟢 cleanup | Drop `@vibesignals/observe` from server deps | XS |
| 6 | 🟢 cleanup | `mcp.json` version bump + attachments mention | XS |
| 7 | 🟡 cleanup | Standardize on `clasp_*` storage prefix | S |
| 8 | 🟡 ops | Refuse to boot in production without `DATABASE_URL` | XS |
| 9 | 🟡 ops | Graceful SIGTERM handler | S |
| 10 | 🟢 ops | PII (emails) in production logs | S — log user IDs instead |

Nothing here is shipped-broken. **#1 and #2** are the only items worth acting on relatively soon. The rest are technical debt — schedule when convenient.
