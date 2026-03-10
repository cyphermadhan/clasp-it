# Clasp It

Pick any element on any webpage and send it instantly to Claude Code via MCP.

```
Chrome Extension → POST https://claspit.dev/element-context
Claude Code      → MCP  https://claspit.dev/mcp
```

**Live at [claspit.dev](https://claspit.dev)**

---

## What It Does

1. Click the Clasp It extension icon → Chrome side panel opens
2. Click "Pick Element" → crosshair cursor activates
3. Hover to highlight any element, click to select it
4. Type an instruction in the floating prompt (Enter to send)
5. Claude Code receives full context via MCP: HTML, CSS, React props, console logs, network requests

---

## MCP Setup

After signing up and getting your API key in the extension:

```bash
claude mcp add --scope user --transport http clasp https://claspit.dev/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

Then in Claude Code:
- *"fix the element I just picked"*
- *"fix all my recent clasp-it picks"*

---

## Repo Structure

```
clasp/
├── extension/        Chrome MV3 extension
│   ├── manifest.json       MV3 — sidePanel + tabs permissions
│   ├── background.js       Opens side panel on icon click; buffers console/network logs
│   ├── content.js          Element picker overlay + floating prompt dialog
│   ├── styles.css          Picker overlay + floating dialog styles (CSS-isolated)
│   ├── sidepanel.html      Chrome side panel UI
│   └── sidepanel.js        Side panel logic (state machine: loading→auth→main→settings)
└── server/           Express MCP server
    ├── index.js
    ├── routes/
    │   ├── auth.js         Magic link auth, device polling, API keys, Dodo Payments
    │   ├── element.js      POST /element-context + GET /picks/statuses
    │   └── mcp.js          MCP endpoint + tools
    ├── lib/
    │   ├── auth.js         Key gen/hashing, requireApiKey middleware, plan feature gating
    │   ├── db.js           Postgres (Neon) pool + schema migrations
    │   └── storage.js      Redis pick storage (Upstash) with in-memory fallback
    └── public/
        ├── index.html      Landing page
        └── verified.html   Magic link confirmation page
```

---

## Plans

| Feature | Free | Pro |
|---------|------|-----|
| Picks per day | 10 | Unlimited |
| DOM & Computed Styles | ✅ | ✅ |
| Screenshot | — | ✅ |
| Console logs | — | ✅ |
| Network requests | — | ✅ |
| React props | — | ✅ |
| Pick history | 10 | 50 |
| Price | Free | $8/mo or $72/yr |

---

## Auth Flow

```
POST /auth/signup        { email, deviceId }  → sends magic link
GET  /auth/poll/:deviceId                     → polls for verification (returns API key once verified)
GET  /auth/verify/:token                      → magic link handler → marks device verified
GET  /auth/info          Bearer <key>         → email + plan
POST /billing/checkout   Bearer <key>         { productId } → Dodo checkout URL
POST /billing/webhook                         → Dodo Payments webhook
```

The extension polls `/auth/poll/:deviceId` every 2s after signup. When the user clicks the magic link, the server marks the device verified, auto-creates an API key, and returns it on the next poll — no session tokens needed in the extension.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_element_context` | Latest pick (auto-marks in_progress) |
| `get_element_context_by_id` | Specific pick by ID |
| `list_recent_picks` | Last N picks (default 10, max 20) |
| `clear_context` | Clear all picks |
| `update_pick_status` | Set status: not_started / in_progress / completed |

---

## Infrastructure

| Service | What for |
|---------|----------|
| [Railway](https://railway.app) | Server hosting (Hobby plan ~$5/mo) |
| [Neon](https://neon.tech) | Postgres — users, API keys, subscriptions |
| [Upstash](https://upstash.com) | Redis — pick ring buffer (last 10 per user, 1h TTL) |
| [Resend](https://resend.com) | Transactional email — magic links |
| [Dodo Payments](https://dodopayments.com) | Subscriptions — Pro plan billing |
| [Porkbun](https://porkbun.com) | claspit.dev domain |

---

## Local Dev

**1. Start the server**
```bash
cd server
cp .env.example .env   # fill in your values
npm install
node index.js
# → clasp-it listening on port 3001
# Without DATABASE_URL: in-memory (no auth enforcement)
# Without REDIS_URL: in-memory picks (lost on restart)
```

**2. Load the extension**
- Chrome → `chrome://extensions` → Enable Developer Mode → Load unpacked → select `extension/`

---

## Environment Variables

```env
# Storage
DATABASE_URL=postgresql://...?sslmode=require   # Neon connection string
REDIS_URL=rediss://...                           # Upstash Redis (rediss:// with double-s)

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
APP_URL=https://claspit.dev
# PORT is auto-injected by Railway — do not set manually
```

---

## What's Next

- DNS: verify claspit.dev ALIAS record on Railway (SSL provisioning in progress)
- Test full end-to-end auth flow (signup → magic link → /verified → API key → MCP)
- Chrome Web Store submission
- `www.claspit.dev` redirect
