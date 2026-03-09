# Clasp It

Pick any element on any webpage and send it instantly to Claude Code via MCP.

```
Chrome Extension → POST https://clasp-it-production.up.railway.app/element-context
Claude Code      → MCP  https://clasp-it-production.up.railway.app/mcp
```

---

## What Was Built

### Phase 1 — Core (complete)

#### Chrome Extension (`extension/`)

| File | What it does |
|------|-------------|
| `manifest.json` | MV3 manifest — permissions, content script injection, service worker |
| `content.js` | Element picker overlay, floating panel UI, sends picks to server |
| `background.js` | Buffers console logs (last 50) and network requests (last 30), handles screenshots |
| `styles.css` | Picker highlight overlay, tooltip, panel styles |
| `panel.html` | Placeholder satisfying `web_accessible_resources`; real panel is injected inline by `content.js` |

**How the extension works:**
1. Click the extension icon → activates crosshair picker mode
2. Hover over any element → blue highlight overlay + tooltip
3. Click element → panel appears (bottom-right, fixed position)
4. Configure context toggles or pick a preset, type an instruction, hit Send
5. Extension POSTs the payload to the server with your API key

**Panel presets:**

| Preset | Captures |
|--------|---------|
| Style fix | DOM + computed styles |
| Debug | DOM + styles + console logs + network requests |
| Redesign | DOM + styles + screenshot + React props |
| Full | Everything |

**Context toggles:**
- DOM & Selector (always on)
- Computed Styles (always on)
- Screenshot
- Console Logs
- Network Requests
- React Props (shown only if React detected on the element)
- Parent DOM Context

---

#### Server (`server/`)

| File | What it does |
|------|-------------|
| `index.js` | Express app, CORS, mounts routes, initialises DB schema on startup |
| `routes/element.js` | `POST /element-context` — validates API key, rate limits, gates pro features, stores pick |
| `routes/mcp.js` | `GET+POST /mcp` — MCP endpoint using `@modelcontextprotocol/sdk` |
| `routes/auth.js` | Auth + billing routes (signup, verify, API keys, Dodo Payments webhook + checkout) |
| `lib/storage.js` | Redis ring buffer (last 10 picks per user, 1h TTL) with in-memory fallback |
| `lib/auth.js` | API key generation/hashing, session management, `requireApiKey`/`requireSession` middleware, plan feature gating |
| `lib/db.js` | Postgres connection pool + idempotent schema migrations |

**MCP tools exposed to Claude Code:**

| Tool | Description |
|------|-------------|
| `get_element_context` | Returns the most recent pick |
| `get_element_context_by_id` | Returns a specific pick by ID |
| `list_recent_picks` | Returns last N picks (default 10, max 20) — use for batch fixes |
| `clear_context` | Clears all picks |

---

### Phase 2 — Auth, Billing, Feature Gating (complete)

#### Authentication
- **Magic link** email flow — no passwords
- Session tokens stored in Redis (7-day TTL) with in-memory fallback
- API keys in format `cit_<32 hex chars>` — SHA-256 hashed before storage, shown once

#### Plans & Feature Gating

| Feature | Free | Pro |
|---------|------|-----|
| Picks per day | 10 | Unlimited |
| Screenshot | — | ✅ |
| Console logs | — | ✅ |
| Network requests | — | ✅ |
| React props | — | ✅ |
| Pick history | 5 | 50 |

#### Payments — Dodo Payments
- Monthly: $8/month
- Annual: $72/year (25% off)
- Webhook handles `subscription.active`, `subscription.renewed`, `subscription.updated`, `subscription.on_hold`, `subscription.failed`

#### Infrastructure
- **Postgres**: Neon (serverless, AWS us-east-1)
- **Redis**: in-memory fallback (Upstash for production)
- **Deployment**: Railway
- **Email**: Resend (`Clasp It <hello@claspit.dev>`)
- **Domain**: claspit.dev

---

## Quick Start (local dev)

**1. Start the server**
```bash
cd server
cp .env.example .env   # fill in your values
npm install
node index.js
# → clasp-it listening on port 3001
```

Without `DATABASE_URL` the server runs fully in-memory (no auth enforcement).
Without `REDIS_URL` picks are stored in-memory (lost on restart).

**2. Load the extension**
- Chrome → `chrome://extensions` → Enable Developer Mode → Load unpacked → select `extension/`

**3. Add MCP to Claude Code**
```bash
claude mcp add --transport http --scope user clasp-it \
  https://clasp-it-production.up.railway.app/mcp \
  --header "X-API-Key: your_cit_key_here"
```

**4. Use it**
- Click the Clasp It icon on any webpage
- Pick an element, type an instruction, hit Send
- In Claude Code: *"fix the element I just picked"*
- For batch fixes: pick multiple elements, then *"fix all my recent clasp-it picks"*

---

## Auth Flow

```
POST /auth/signup        { email }         → sends magic link email
GET  /auth/verify/:token                  → validates link → session token
GET  /auth/me            Bearer <session>  → user info, plan, API keys
POST /auth/keys          Bearer <session>  → create API key (cit_...)
DELETE /auth/keys/:id    Bearer <session>  → revoke API key
POST /billing/checkout   Bearer <session>  { productId } → Dodo checkout URL
GET  /billing/portal     Bearer <session>  → subscription info
POST /auth/webhook                         → Dodo Payments webhook
```

---

## Environment Variables

```env
# Server
PORT=3001
CORS_ORIGIN=*

# Storage
DATABASE_URL=postgresql://...   # Neon connection string
REDIS_URL=redis://...           # Upstash or local Redis (optional)

# Email
RESEND_API_KEY=re_...
RESEND_FROM=Clasp It <hello@claspit.dev>

# Dodo Payments
DODO_API_KEY=sk_...
DODO_WEBHOOK_KEY=whsec_...
DODO_PRODUCT_PRO_MONTHLY=prd_...
DODO_PRODUCT_PRO_ANNUAL=prd_...
DODO_ENV=live_mode              # test_mode | live_mode

# App
APP_URL=https://clasp-it-production.up.railway.app
```

---

## Payload Shape

```json
{
  "id": "pick_1234567890",
  "timestamp": "2026-03-09T10:30:00Z",
  "prompt": "make this button use the primary variant",
  "element": {
    "selector": "nav > ul > li:nth-child(2) > button",
    "tagName": "button",
    "id": "",
    "classList": ["btn", "btn-ghost"],
    "attributes": { "data-variant": "ghost" },
    "innerText": "Settings",
    "innerHTML": "<span>Settings</span>",
    "computedStyles": { "backgroundColor": "transparent", "border": "1px solid #0052CC" },
    "dimensions": { "width": 120, "height": 36, "top": 64, "left": 240 }
  },
  "toggles": {
    "dom": true,
    "styles": true,
    "screenshot": false,
    "console": false,
    "network": false,
    "react": false,
    "parent": false
  }
}
```

---

## What's Next (Phase 3)

- Website: landing page, pricing page, dashboard (manage API keys, view usage)
- Upstash Redis for production pick persistence
- Chrome Web Store submission
- Custom domain (`api.claspit.dev`) on Railway
