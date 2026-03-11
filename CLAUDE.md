# Clasp It — Claude Context

## What this is
A Chrome extension + hosted MCP server that lets developers click any webpage element and send its context to Claude Code. One click captures HTML, CSS, React props, console logs, network requests, and screenshot — delivered to Claude Code via MCP.

## Repo structure
```
clasp/
├── extension/        Chrome MV3 extension (side panel, picker UI, background worker)
│   ├── manifest.json       MV3 — sidePanel + tabs permissions
│   ├── background.js       Opens side panel on icon click; buffers console/network
│   ├── content.js          Element picker overlay + floating prompt dialog
│   ├── styles.css          Picker overlay + floating dialog styles
│   ├── sidepanel.html      Chrome side panel UI  ✅ COMPLETE
│   ├── sidepanel.js        Side panel logic       ✅ COMPLETE
│   └── panel.html          Legacy placeholder (kept for web_accessible_resources)
├── server/           Express MCP server (auth, billing, storage, MCP endpoint)
│   ├── index.js
│   ├── public/             Static website (served by Express)
│   │   ├── index.html      Landing page (single scroll — hero, how it works, setup, pricing)
│   │   └── verified.html   Shown after magic link click
│   ├── routes/
│   │   ├── auth.js   Auth + billing (magic link, device polling, API keys, Dodo Payments)
│   │   ├── element.js POST /element-context + GET /picks/statuses
│   │   └── mcp.js    MCP endpoint + update_pick_status tool
│   └── lib/
│       ├── auth.js   Key gen, session, middleware, feature gating
│       ├── db.js     Postgres (Neon) pool + schema migrations + SSL fix
│       └── storage.js Redis/in-memory pick storage, device verification, pick status
```

## Production URLs
- **Server + Website**: `https://claspit.dev`
- **MCP**: `https://claspit.dev/mcp`
- **Old Railway URL**: `https://clasp-it-production.up.railway.app` (still works, same deployment)

## Infrastructure
- **Hosting**: Railway Hobby ($5/mo) — auto-deploys from GitHub main branch
- **Database**: Neon (Postgres, serverless)
- **Cache**: Upstash Redis (picks storage, sessions)
- **Email**: Resend, sender `Clasp It <hello@claspit.dev>`
- **Payments**: Dodo Payments (not Stripe — invite-only in India)
- **Domain**: claspit.dev → Railway via Porkbun ALIAS record
- **Auth**: Magic link → device polling → API key auto-created (`cit_` prefix)

## Plans
| | Free | Pro |
|--|------|-----|
| Picks/day | 10 | Unlimited |
| Screenshot, console, network, React props | ✗ | ✅ |
| Pricing | Free (email required) | $19 one-time |

## Key env vars (Railway)
- `DATABASE_URL` — Neon connection string (`sslmode=require` — never `verify-full`)
- `REDIS_URL` — Upstash Redis URL (`rediss://...`)
- `RESEND_API_KEY`, `RESEND_FROM`
- `DODO_API_KEY`, `DODO_WEBHOOK_KEY`, `DODO_PRODUCT_PRO_MONTHLY`, `DODO_PRODUCT_PRO_ANNUAL`, `DODO_ENV`
- `APP_URL=https://claspit.dev`
- `CORS_ORIGIN=*`

## What's done
- ✅ Phase 1: Chrome extension + MCP server (element picker, context capture, MCP tools)
- ✅ Phase 2: Auth (magic link), API keys, Dodo Payments, feature gating, rate limiting
- ✅ Phase 3: Landing page, /verified page, /upgrade page, custom domain, Upstash Redis
- ✅ Extension: Sidebar fully redesigned (complete state machine, history, feature gating)
- ✅ Extension: Picker UX — hover highlights; click shows floating prompt dialog (Figma design)
- ✅ Extension: Floating dialog uses custom SVG icons (close + ArrowUp), fully CSS-isolated
- ✅ Extension: All URLs updated to claspit.dev
- ✅ Extension: Daily pick counter (`X/10 today`) in Recent picks header (free users)
- ✅ Extension: Rate limit UX — button disabled + info banner (blue Anthropic colors) when limit hit
- ✅ Extension: `startCheckout()` — calls `/billing/checkout` with API key → opens Dodo URL directly (no email in URL)
- ✅ Extension: "Already upgraded? Refresh" link re-fetches plan from server
- ✅ Extension: `clasp_limit_date` flag in chrome.storage — server-authoritative rate limit tracking (resets next day, clears on Pro upgrade)
- ✅ Server: Bearer token auth (`Authorization: Bearer`) alongside `X-API-Key`
- ✅ Server: `initSchema()` non-fatal, SSL fix for Neon on Railway
- ✅ Server: Static site served from `server/public/` via `express.static`
- ✅ Server: `/billing/checkout` accepts API key auth (resolves email from DB) or plain email body (website flow)
- ✅ Infrastructure: Neon + Upstash Redis + Railway Hobby + claspit.dev domain all live
- ✅ Infrastructure: `railway.toml` + `nixpacks.toml` fix for monorepo (app in `server/` subdir)
- ✅ Website: Anthropic font system (AnthropicSans body, AnthropicSerif headings, AnthropicMono code)
- ✅ Website: Product name standardised to `Clasp-it` throughout
- ✅ Website: Nav logo uses extension icon PNG + plain font text
- ✅ Website: SVG step illustrations in "How it works" section
- ✅ Website: Pricing section — "Most popular" badge, CTA buttons, gradient, hover shadows
- ✅ Website: Footer email → `dev@madhans.world`, removed "Setup docs" link
- ✅ Website: `/upgrade` page — email input → Dodo checkout → `/verified?checkout=success`
- ✅ Website: `/verified` handles both magic-link verification and post-payment success

## Picker UX flow
1. User clicks "Pick Element" → picker activates (crosshair cursor, highlight overlay)
2. Hovering highlights elements (no dialog shown yet)
3. Clicking an element → picker deactivates → floating prompt dialog appears next to element
4. Dialog shows element label (tag.class), textarea, close (X) button, orange send (↑) button
5. Enter or send button → card added to sidebar history + picker re-activates
6. Shift+Enter = newline in textarea

## Floating dialog CSS isolation
All `#clasp-float-*` elements use `all: initial !important` to prevent host page CSS bleeding in.
Event listeners use bubble phase (not capture) so child button clicks aren't intercepted by parent.

## Server API
```
POST /auth/signup              — register email + deviceId (magic link sent)
GET  /auth/verify/:token       — validate magic link → redirect to /verified
GET  /auth/poll/:deviceId      — poll for magic link verification (no auth)
GET  /auth/info                — email + plan for API key (X-API-Key or Bearer auth)
POST /element-context          — store a pick (X-API-Key or Bearer auth)
GET  /picks/statuses?ids=      — status map for pick IDs
POST /billing/checkout         — create Dodo checkout session
POST /billing/webhook          — Dodo webhook handler
```

## MCP tools
| Tool | Description |
|------|-------------|
| `get_element_context` | Latest pick (auto-marks in_progress) |
| `get_element_context_by_id` | Specific pick by ID (auto-marks in_progress) |
| `list_recent_picks` | Last N picks |
| `clear_context` | Clear all picks |
| `update_pick_status` | Set status: not_started / in_progress / completed |

## MCP install command
```
claude mcp add --scope user --transport http clasp-it https://claspit.dev/mcp --header "Authorization: Bearer YOUR_API_KEY"
```
To update the key later: `claude mcp remove clasp` then re-add.

## Sidebar state machine
1. `loading` — check chrome.storage for API key
2. `auth` — email input → "Get free API key" (or paste existing key)
3. `verifying` — "check your email" + polls GET /auth/poll/:deviceId every 2s
4. `main` — pick button + history list (status badges) + gear icon + Claude tip
5. `picking` — "click any element..." + cancel
6. `picked` — (not used in quick-send flow; quick-send goes straight to main)
7. `settings` — email, plan badge, upgrade button, API key display, sign out, MCP setup

## History items
- Stored in chrome.storage.local (max 50 pro / 10 free)
- Each item: `{ id, pickId, elementLabel, pageURL, prompt, status, sentAt }`
- Status: `not_started | in_progress | completed` — polled from GET /picks/statuses every 5s
- `not_started` items show ✕ delete button; other statuses show badge
- Prompt text shown inline under element label

## Feature gating
- Free: DOM & Selector + Computed Styles only (pro toggles greyed with "PRO" badge)
- Pro: all toggles available (screenshot, console, network, react, parent)
- Plan fetched via GET /auth/info after auth

## Website (server/public/)
- Single scrolling page — no separate dashboard, no login
- All account management done in the Chrome extension
- Pages: `index.html` (landing), `verified.html` (post magic-link + post-payment), `upgrade.html` (Dodo checkout entry)

## What's next
1. ⏳ Chrome Web Store submission — submitted, awaiting review
2. ~~`www.claspit.dev` redirect~~ — skipped (Railway charges per extra domain)
3. Test full upgrade flow end-to-end (Dodo checkout → webhook → plan update → extension refresh)
4. Verify `DODO_PRODUCT_PRO` env var is set on Railway (currently `DODO_PRODUCT_PRO_MONTHLY` + `DODO_PRODUCT_PRO_ANNUAL` — checkout route uses `DODO_PRODUCT_PRO`)

## Future refinements (planned, not built)

### Projects (Pro plan only)
Let Pro users organise picks into named projects so Claude knows which picks belong to which codebase.

**Problem:** With multiple VS Code windows open in parallel, `list_recent_picks` mixes picks from all projects. URL filtering doesn't work if both projects reference the same third-party sites.

**Planned design:**
- Pro users create named projects in extension settings; free plan gets one default project
- Project selector in main panel — user sets active project before picking
- Each pick tagged with `projectId` + `projectName`
- `list_recent_picks` MCP tool accepts optional `project` filter param
- Claude usage: *"fix all clasp picks from the 'dashboard' project"*

**Server changes needed:**
- `projects` table: `id, user_id, name, created_at`
- `POST /element-context` accepts optional `projectId`
- `list_recent_picks` and `/picks/statuses` accept optional `project` filter

**Extension changes needed:**
- Project management UI in settings (Pro gate)
- Active project selector on main screen
- Project name on history cards

See PLAN.md for full spec.

## Coding conventions
- ES modules (`"type": "module"` in package.json)
- No TypeScript — plain JS throughout
- Graceful degradation: no `DATABASE_URL` → in-memory; no `REDIS_URL` → in-memory
- Never use Stripe (invite-only in India) — Dodo Payments only
- Auth: accept both `X-API-Key` header and `Authorization: Bearer` in `requireApiKey` middleware

## Infrastructure gotchas
- **Neon SSL**: always use `sslmode=require` in DATABASE_URL — never `sslmode=verify-full`. `db.js` adds `ssl: { rejectUnauthorized: false }` for Neon URLs as safety net.
- **Redis**: Upstash URL format is `rediss://` (double s) — not `redis://`
- **Railway PORT**: do not set PORT manually — Railway auto-injects it. App listens on `process.env.PORT ?? 3001`.
- **DB outage = in-memory fallback**: wrong DATABASE_URL causes silent fallback. After fixing, users must re-authenticate.
- **CORS**: extension needs `host_permissions` in manifest for the server URL — reload extension after URL changes.
- **MCP auth test**: `curl https://claspit.dev/auth/info -H "Authorization: Bearer KEY"`
- **DNS**: claspit.dev uses ALIAS record on Porkbun (not CNAME — root domain restriction). TXT `_railway-verify` for Railway verification.
