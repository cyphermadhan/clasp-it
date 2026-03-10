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
│   ├── sidepanel.html      Chrome side panel UI  ← IN PROGRESS (redesign paused)
│   ├── sidepanel.js        Side panel logic       ← IN PROGRESS (redesign paused)
│   └── panel.html          Legacy placeholder (kept for web_accessible_resources)
├── server/           Express MCP server (auth, billing, storage, MCP endpoint)
│   ├── index.js
│   ├── routes/
│   │   ├── auth.js   Auth + billing (magic link, device polling, API keys, Dodo Payments)
│   │   ├── element.js POST /element-context + GET /picks/statuses
│   │   └── mcp.js    MCP endpoint + update_pick_status tool
│   └── lib/
│       ├── auth.js   Key gen, session, middleware, feature gating
│       ├── db.js     Postgres (Neon) pool + schema migrations
│       └── storage.js Redis/in-memory pick storage, device verification, pick status
└── web/              Phase 3 — not built yet (Next.js planned)
```

## Production URLs
- **Server**: `https://clasp-it-production.up.railway.app`
- **MCP**: `https://clasp-it-production.up.railway.app/mcp`
- **Domain**: claspit.dev (DNS not yet pointed to Railway)

## Infrastructure
- **Hosting**: Railway (server), Neon (Postgres), in-memory (picks — Upstash Redis pending)
- **Email**: Resend, sender `Clasp It <hello@claspit.dev>`
- **Payments**: Dodo Payments (not Stripe — Stripe is invite-only in India)
- **Auth**: Magic link → device polling → API key auto-created (`cit_` prefix)

## Plans
| | Free | Pro |
|--|------|-----|
| Picks/day | 10 | Unlimited |
| Screenshot, console, network, React props | ✗ | ✅ |
| Pricing | Free (email required) | $8/mo or $72/yr |

## Key env vars (Railway)
- `DATABASE_URL` — Neon connection string
- `RESEND_API_KEY`, `RESEND_FROM`
- `DODO_API_KEY`, `DODO_WEBHOOK_KEY`, `DODO_PRODUCT_PRO_MONTHLY`, `DODO_PRODUCT_PRO_ANNUAL`, `DODO_ENV`
- `APP_URL=https://clasp-it-production.up.railway.app`
- `REDIS_URL` — not set yet (using in-memory fallback)

## What's done
- ✅ Phase 1: Chrome extension + MCP server (element picker, context capture, MCP tools)
- ✅ Phase 2: Auth (magic link), API keys, Dodo Payments, feature gating, rate limiting, Railway deploy
- ✅ Side panel: Extension icon now opens Chrome side panel (not inline panel)
- ✅ Server: Device polling auth flow (signup with deviceId → verify → poll for API key)
- ✅ Server: Pick status tracking (not_started → in_progress → completed) + MCP update_pick_status tool
- ✅ Server: GET /auth/info (plan + email via API key), GET /auth/poll/:deviceId, GET /picks/statuses
- ✅ Extension: Floating prompt dialog next to hovered element during picking

## What's in progress (Phase 3 — sidebar redesign, PAUSED mid-session)
The sidebar (sidepanel.html + sidepanel.js) needs a full redesign. Paused to get the
correct design tokens from the Figma kit. Figma MCP server has been added for next session.

### Sidebar redesign spec:
**Screens/state machine:**
1. `loading` — check storage for API key
2. `auth` — email input → "Get free API key" (or paste existing key)
3. `verifying` — "check your email" + polls GET /auth/poll/:deviceId every 2s
4. `main` — pick button + history list + gear icon
5. `picking` — "click any element..." + cancel
6. `picked` — element form (toggles gated by plan, presets, prompt, send)
7. `settings` — email, plan badge, upgrade link, API key display, sign out

**Feature gating by plan:**
- Free: DOM & Selector + Computed Styles only (pro toggles greyed with "PRO" badge)
- Pro: all toggles available
- Plan fetched via GET /auth/info after auth

**History:**
- Stored in chrome.storage.local as array (max 50 pro / 10 free)
- Each item: { id, pickId, elementLabel, pageURL, prompt, status, sentAt }
- Status: not_started | in_progress | completed (polled from GET /picks/statuses every 5s)
- Status badges shown in history list

**Quick send (floating dialog):**
- When user submits floating dialog (Enter or button), sends ELEMENT_PICKED with quickSend:true
- Sidebar handles quickSend by auto-sending with current toggle settings (no form shown)
- After send, switches to main state + adds item to history

**Design:** Use "MCP Apps for Claude" Figma kit tokens (Figma MCP added, read next session)

## Server API added this session
```
GET  /auth/poll/:deviceId   — poll for magic link verification (no auth)
GET  /auth/info             — email + plan for API key (X-API-Key auth)
GET  /picks/statuses?ids=   — status map for pick IDs (X-API-Key auth)
```

## MCP tools
| Tool | Description |
|------|-------------|
| `get_element_context` | Latest pick (auto-marks in_progress) |
| `get_element_context_by_id` | Specific pick by ID (auto-marks in_progress) |
| `list_recent_picks` | Last N picks |
| `clear_context` | Clear all picks |
| `update_pick_status` | Set status: not_started / in_progress / completed |

## What's next (next session)
1. Read Figma tokens via Figma MCP server (added: `claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp`)
2. Rewrite sidepanel.html + sidepanel.js using Claude MCP Apps design tokens
3. Add `GET /verified` page to server (shown after magic link click — "You're verified, close this tab")
4. Deploy server to Railway (picks up new routes/schema)
5. Phase 3: web/ Next.js site, Upstash Redis, Chrome Web Store

## Coding conventions
- ES modules (`"type": "module"` in package.json)
- No TypeScript — plain JS throughout
- Graceful degradation: no `DATABASE_URL` → in-memory; no `REDIS_URL` → in-memory
- Never use Stripe (invite-only in India) — Dodo Payments only
