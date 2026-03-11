# Clasp It — Complete Build Plan

## What We're Building

A Chrome extension that lets you click any frontend element on any webpage, configure what context to capture, add a natural language instruction, and send it to a **hosted MCP server** that Claude Code connects to remotely — no local install required.

```
Chrome Extension → POST https://api.clasp-it.com/element-context
Claude Code      → MCP  https://api.clasp-it.com/mcp
```

**User setup is exactly two steps:**
```
1. Chrome Web Store → Add to Chrome
2. claude mcp add --transport http clasp-it \
     https://api.clasp-it.com/mcp \
     --header "X-API-Key: their-key"
```

---

## Full Architecture

```
┌─────────────────────┐       ┌────────────────────────────┐       ┌──────────────┐
│   Chrome Extension  │─POST─▶│   clasp-it.com        │◀─MCP──│  Claude Code │
│   (element picker)  │       │   (your hosted server)      │       │  (terminal)  │
└─────────────────────┘       └────────────────────────────┘       └──────────────┘
                                         │
                               ┌─────────┴──────────┐
                               │  Postgres + Redis   │
                               │  (picks per user)   │
                               └────────────────────┘
```

---

## Repo Structure

```
clasp-it/
├── extension/
│   ├── manifest.json
│   ├── content.js              ← element picker + highlight overlay
│   ├── panel.html              ← floating UI panel
│   ├── panel.js                ← toggle logic + POST to hosted server
│   ├── background.js           ← console/network capture, screenshot
│   └── styles.css
├── server/
│   ├── index.js                ← main server entry
│   ├── routes/
│   │   ├── element.js          ← POST /element-context
│   │   ├── mcp.js              ← MCP endpoint
│   │   └── auth.js             ← API key + webhook handling
│   ├── lib/
│   │   ├── storage.js          ← Redis/Postgres read/write
│   │   └── tier.js             ← feature gating by plan
│   └── package.json
└── website/
    ├── index.html              ← landing page
    ├── dashboard.html          ← API key + usage dashboard
    └── pricing.html
```

---

## Part 1 — Chrome Extension

### manifest.json

- Manifest V3
- Permissions: `activeTab`, `scripting`, `storage`, `webNavigation`, `webRequest`
- Host permissions: `https://api.clasp-it.com/*`
- Content scripts: inject `content.js` on all URLs
- Background service worker: `background.js`
- Action: clicking extension icon triggers `START_PICKING`

---

### content.js — Element Picker

**Activation:** On `START_PICKING` message from background, activate picker mode.

**Hover behaviour:**
- `mouseover` listener on all elements
- Draw a blue outlined highlight overlay (absolutely positioned div, does not modify the element)
- Small tooltip showing tag name and first class

**Click behaviour:**
- `preventDefault` + `stopPropagation`
- Collect element data
- Remove listeners + overlay
- Open panel

**Element data collected on click:**
```js
{
  selector: generateUniqueSelector(el),
  tagName: el.tagName,
  id: el.id,
  classList: [...el.classList],
  attributes: getAllAttributes(el),       // data-*, aria-*, etc.
  innerText: el.innerText.slice(0, 200),
  innerHTML: el.innerHTML.slice(0, 500),
  computedStyles: getCriticalStyles(el),
  dimensions: el.getBoundingClientRect(),
  parentHTML: el.parentElement?.outerHTML.slice(0, 500),
  pageURL: window.location.href,
  pageTitle: document.title
}
```

**Critical computed styles:** `display`, `position`, `width`, `height`, `margin`, `padding`, `fontSize`, `fontFamily`, `fontWeight`, `color`, `backgroundColor`, `border`, `borderRadius`, `boxShadow`, `opacity`, `zIndex`, `flexDirection`, `alignItems`, `justifyContent`, `gap`, `lineHeight`, `letterSpacing`

**`generateUniqueSelector(el)`:** Walk up DOM building a CSS path. Prefer `#id`. Otherwise `tagName + classes + nth-child`. Stop at `body`.

---

### panel.html + panel.js — Floating UI

Injected DOM element (not iframe), fixed position bottom-right, z-index `999999`.

**Panel layout:**

```
┌─────────────────────────────────────────┐
│ 📍 button.nr-button--ghost          ✕  │
│    https://app.newrelic.com/dashboard   │
│ ─────────────────────────────────────── │
│ Context to send:                        │
│                                         │
│ [✅] DOM & Selector     (always on)     │
│ [✅] Computed Styles    (always on)     │
│ [☐ ] Screenshot                         │
│ [☐ ] Console Logs                       │
│ [☐ ] Network Requests                   │
│ [☐ ] React Props        (if detected)   │
│ [☐ ] Parent DOM Context                 │
│                                         │
│ [Style fix] [Debug] [Redesign] [Full]   │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Describe what to change...          │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Pick another]       [Send to MCP →]    │
└─────────────────────────────────────────┘
```

**Preset profiles:**

| Preset | Toggles |
|--------|---------|
| Style fix | DOM + Styles |
| Debug | DOM + Styles + Console + Network |
| Redesign | DOM + Styles + Screenshot + React Props |
| Full | All |

**Detecting React:** check `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` or `__reactFiber` on element.

**On "Send to MCP":**
1. Collect enabled context based on toggles
2. Screenshot (if toggled) → `chrome.runtime.sendMessage CAPTURE_SCREENSHOT` → crop to element bounds → base64
3. Console logs (if toggled) → request buffer from background
4. Network requests (if toggled) → request buffer from background
5. React props (if toggled) → `chrome.scripting.executeScript` to extract `__reactFiber`
6. Retrieve API key from `chrome.storage.local`
7. POST to `https://api.clasp-it.com/element-context` with `X-API-Key` header
8. Show: `✅ Sent. Switch to Claude Code.`

**Feature gating by plan:** Free tier users see pro toggles (Screenshot, Console, Network, React Props) greyed out with an upgrade tooltip. Tier info fetched from the server on panel open and cached in `chrome.storage.local`.

**Persist toggle state** in `chrome.storage.local`.

**API key onboarding:** If no API key is set, show an onboarding state in the panel:
```
🔑 Connect your account
Enter your API key from clasp-it.com
[________________] [Save]
Don't have one? Get it free →
```

---

### background.js — Service Worker

**Console log buffering:** Override `console.log/warn/error` via injected script, buffer last 50 entries. Respond to `GET_CONSOLE_LOGS`.

**Network request buffering:** `chrome.webRequest.onCompleted` buffers last 30 requests. Capture URL, method, status, headers. Respond to `GET_NETWORK_REQUESTS`.

**Screenshot:** `CAPTURE_SCREENSHOT` → `chrome.tabs.captureVisibleTab` → crop to element dimensions → return base64.

**Icon click:** Send `START_PICKING` to active tab.

---

## Part 2 — Hosted Server

**Stack:** Node.js + Express + `@modelcontextprotocol/sdk`

**Hosting:** Railway, Fly.io, or Render — all support Node, Postgres, Redis at low cost. Railway is the fastest to deploy.

### Routes

#### `POST /element-context`
Receives element pick from the Chrome extension.

```js
Headers: X-API-Key: <user key>
Body: full payload JSON

1. Validate API key → look up user
2. Check rate limit / plan tier
3. Strip disallowed context fields based on plan
   (e.g. free tier: remove screenshot, consoleLogs, networkRequests, reactProps)
4. Store in Redis: key = `picks:<userId>`, value = last 10 picks (ring buffer)
5. Also persist to Postgres for usage analytics
6. Return: { success: true, id: "pick_<timestamp>" }
```

#### `GET /mcp` (MCP endpoint)
Claude Code connects here over HTTP transport.

**MCP tools exposed:**

| Tool | Description |
|------|-------------|
| `get_element_context()` | Returns the most recent pick for this API key |
| `get_element_context_by_id(id)` | Returns specific pick by ID |
| `list_recent_picks()` | Returns last 10 picks with timestamps and selectors |
| `clear_context()` | Clears stored picks for this user |

Each tool call authenticates via the `X-API-Key` header passed in the `claude mcp add` command.

#### `POST /auth/webhook`
Stripe webhook handler — updates user plan in Postgres on subscription events.

#### `GET /auth/me`
Returns current user plan + usage for the dashboard.

#### `POST /auth/keys`
Generates a new API key for the user.

---

### Storage Schema

**Postgres:**
```sql
users
  id, email, stripe_customer_id, plan, created_at

api_keys
  id, user_id, key_hash, label, created_at, last_used_at

picks (analytics)
  id, user_id, page_url, selector, prompt, plan_at_time,
  had_screenshot, had_console, had_network, had_react,
  created_at
```

**Redis:**
```
picks:<userId>   → JSON array of last 10 picks (ring buffer, TTL 24h)
tier:<userId>    → cached plan tier (TTL 1h)
ratelimit:<userId>:<date> → pick count today
```

---

## Part 3 — MCP Payload Shape

```json
{
  "id": "pick_1234567890",
  "timestamp": "2026-03-09T10:30:00Z",
  "pageURL": "http://localhost:3000/dashboard",
  "prompt": "change this to the primary variant",
  "element": {
    "selector": "nav > ul > li:nth-child(2) > button",
    "tagName": "BUTTON",
    "id": "",
    "classList": ["nr-button", "nr-button--ghost"],
    "attributes": { "data-component": "Button", "variant": "ghost" },
    "innerText": "Settings",
    "innerHTML": "<span>Settings</span>",
    "dimensions": { "width": 120, "height": 36, "top": 64, "left": 240 }
  },
  "context": {
    "computedStyles": {
      "backgroundColor": "transparent",
      "border": "1px solid #0052CC",
      "borderRadius": "4px",
      "padding": "8px 16px",
      "fontSize": "14px",
      "color": "#0052CC"
    },
    "screenshot": null,
    "consoleLogs": [
      { "level": "warn", "message": "Missing key prop", "timestamp": "..." }
    ],
    "networkRequests": [
      { "url": "/api/user", "method": "GET", "status": 200 }
    ],
    "reactProps": {
      "component": "Button",
      "props": { "variant": "ghost", "disabled": false }
    },
    "parentContext": "<nav class='nr-nav'>...</nav>"
  }
}
```

---

## Part 4 — Payments (Stripe)

**Why Stripe:** Best global coverage, supports 135+ currencies, handles tax (VAT/GST) automatically via Stripe Tax, strong developer docs. For a dev tools product with a global audience it's the right default.

**Alternative for lower fees:** Lemon Squeezy handles VAT/GST compliance automatically and charges a flat 5% + 50¢ per transaction with no monthly fee — simpler for solo founders, slightly higher per-transaction cost.

**Recommendation:** Start with Stripe. It's what developers trust and recognise.

---

### Pricing Tiers

| | Free | Pro | Team |
|---|---|---|---|
| **Price** | $0 | $19 one-time | — |
| **Picks/day** | 20 | Unlimited | Unlimited |
| **DOM + Styles** | ✅ | ✅ | ✅ |
| **Screenshot** | ❌ | ✅ | ✅ |
| **Console Logs** | ❌ | ✅ | ✅ |
| **Network Requests** | ❌ | ✅ | ✅ |
| **React Props** | ❌ | ✅ | ✅ |
| **Pick history** | Last 5 | Last 50 | Last 200 |
| **Team seats** | 1 | 1 | 5 |
| **Priority support** | ❌ | ❌ | ✅ |

---

### Stripe Integration

**Setup:**
1. Create Stripe account at stripe.com
2. Create two products: Pro (monthly + annual) and Team (monthly)
3. Enable Stripe Tax for automatic VAT/GST handling globally
4. Set up Customer Portal for self-serve subscription management

**Server-side flow:**
```
User clicks "Upgrade" on website
  → Create Stripe Checkout Session (server-side)
  → Redirect user to Stripe hosted checkout
  → Stripe handles payment + VAT globally
  → On success: Stripe fires webhook to POST /auth/webhook
  → Server updates user.plan in Postgres
  → Redis tier cache invalidated
  → User's next extension panel open shows pro features unlocked
```

**Key Stripe events to handle in webhook:**
```
checkout.session.completed     → activate subscription
customer.subscription.updated  → plan change (upgrade/downgrade)
customer.subscription.deleted  → cancellation → downgrade to free
invoice.payment_failed         → grace period logic (keep pro for 3 days)
```

**Customer Portal:**
```
GET /billing/portal
  → stripe.billingPortal.sessions.create(...)
  → redirect user to Stripe's hosted portal
  (handles cancellation, plan change, payment method update — no custom UI needed)
```

---

### API Key Flow

1. User signs up with email (magic link or GitHub OAuth)
2. Dashboard shows their API key + current plan + usage stats
3. User copies key into Chrome extension (one-time)
4. User runs `claude mcp add` with key in header (one-time)
5. Key is hashed in Postgres — raw key only shown once at creation

---

## Part 5 — Website

Three pages needed at launch:

**Landing page (`/`)**
- What it does, 30-second explainer
- Two CTAs: "Add to Chrome" + "View pricing"
- Short demo GIF showing pick → Claude Code edit

**Pricing page (`/pricing`)**
- Free / Pro / Team table
- "Start free" → sign up
- "Upgrade to Pro" → Stripe Checkout

**Dashboard (`/dashboard`)** (post-login)
- API key (show/copy/regenerate)
- Current plan + usage this month
- "Manage subscription" → Stripe Customer Portal
- Setup instructions (the two commands)

---

## Part 6 — User Setup (Final)

**One-time setup (2 steps, ~2 minutes):**

```
Step 1: Install from Chrome Web Store → Add to Chrome

Step 2: Sign up at clasp-it.com → copy API key → paste into extension

Step 3: In terminal (one time, global):
claude mcp add --scope user --transport http clasp-it \
  https://api.clasp-it.com/mcp \
  --header "X-API-Key: your-key-here"
```

**Daily usage:**
```
1. Click extension icon on any webpage
2. Click the element you want to change
3. Toggle context (or pick a preset)
4. Type your instruction
5. Hit Send
6. Switch to Claude Code → type: get the element I just picked and apply the change
```

---

## Future Refinements

### Projects (Pro plan only)
Allow Pro users to organise picks into named projects so Claude knows which picks belong to which codebase.

**Problem it solves:** When two projects are open in parallel, `list_recent_picks` returns picks from both — Claude can't tell which belongs where. URL filtering doesn't help if both projects reference the same third-party sites.

**Design:**
- Pro users can create named projects in extension settings (free plan gets a single default project)
- A project selector appears in the side panel — user sets the active project before picking
- Each pick is tagged with `projectId` + `projectName` when sent to the server
- `list_recent_picks` MCP tool accepts an optional `project` param to filter
- Claude usage: *"fix all clasp picks from the 'dashboard' project"*

**Server changes:**
- `POST /element-context` accepts optional `projectId`
- `GET /picks/statuses` and `list_recent_picks` accept optional `project` filter
- Projects table in Postgres: `id, user_id, name, created_at`

**Extension changes:**
- Project management UI in settings (Pro only)
- Active project selector in main screen
- Project name shown on history cards

---

## Part 7 — Build Order

### Phase 1 — Core (validate the idea)
1. `server/routes/element.js` — POST endpoint, store in Redis (no auth yet, just hardcode a key)
2. `server/routes/mcp.js` — MCP endpoint with `get_element_context()` tool
3. `extension/content.js` — element picker + highlight overlay
4. `extension/panel.html + panel.js` — panel UI with basic toggles, POST to server
5. `extension/background.js` — console/network buffers, screenshot
6. End-to-end test: pick → POST → Claude Code reads it → edits file

### Phase 2 — Auth + Payments
7. User auth (magic link via Resend or GitHub OAuth via NextAuth)
8. API key generation + validation middleware
9. Stripe integration: Checkout, webhook handler, Customer Portal
10. Plan-based feature gating on server + extension UI
11. Rate limiting (Redis)

### Phase 3 — Website + Launch
12. Landing page + pricing page
13. User dashboard (API key + usage + billing portal link)
14. Chrome Web Store listing (screenshots, description, privacy policy)
15. Submit to claudecodemarketplace.net for discovery
16. Write setup docs + post on LinkedIn / X

---

## Infrastructure Cost Estimate (at launch)

| Service | Cost |
|---------|------|
| Railway (server + Postgres + Redis) | ~$5–10/month |
| Domain | ~$12/year |
| Stripe | 2.9% + 30¢ per transaction (no monthly fee) |
| **Total fixed cost** | **~$10/month** |

Break-even: **2 Pro subscribers** covers all fixed costs.
