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

## Next Up — Attachments, Edit Picks, Top-ups, Max Plan

Status: planned, not built. Phasing at the end of this section.

### 1. Attachments (Pro-only)

Let Pro users attach images and short text files to a pick so Claude has the full visual + spec context, not just the DOM.

**UX**
- Floating dialog gets a paperclip button next to the send button
- Drag-and-drop onto the dialog also adds attachments
- Thumbnails strip below the textarea — image previews + filename pills, each with a ✕
- Pasting an image from clipboard into the textarea adds it as an attachment

**Limits**
- 3 attachments per pick
- 5 MB per file
- Allowed types: images (`png`, `jpg`, `jpeg`, `gif`, `webp`) + text (`md`, `txt`, `json`)
- Monthly cap: **30 picks-with-attachments per month** on Pro (resets on the 1st)
- Picks without attachments stay unlimited on Pro

**Storage — Cloudflare R2**
- Server-proxy upload: extension → `POST /element-context/:id/attachments` (multipart) → server validates type/size/quota → server uploads to R2 → returns attachment metadata
- R2 keys: `picks/<userId>/<pickId>/<attachmentId>.<ext>`
- Server holds R2 credentials; extension never touches R2 directly
- Auto-delete: when `update_pick_status` flips a pick to `completed`, server deletes all R2 objects for that pick (best effort, async)

**MCP integration**
- `get_element_context`, `get_element_context_by_id`, `list_recent_picks` include an `attachments[]` array on each pick
- Each attachment: `{ id, filename, mimeType, sizeBytes, url }` where `url` is a signed GET URL with **1 hour** expiry, generated at request time
- Text attachments are also returned inline (small, useful for prompts/specs); images are URL-only

**Server changes**
- New: `server/lib/r2.js` — `@aws-sdk/client-s3` wrapper for R2 (put, delete, signed GET)
- `db.js` — new `attachments` table: `id, pick_id, user_id, r2_key, filename, mime_type, size_bytes, created_at`
- `storage.js` — extend pick payload to include `attachments[]`; helpers for monthly counter (`attachments_used:<userId>:<YYYY-MM>` in Redis)
- `auth.js` — extend `PLANS` with attachment caps; quota helper `getAttachmentQuota(userId) → { used, limit, bonus }`
- `routes/element.js` — three new endpoints (see below)
- `routes/mcp.js` — populate `attachments[]` with signed URLs; auto-delete hook on `update_pick_status` → completed
- `package.json` — add `@aws-sdk/client-s3` + `multer`

**New endpoints**
```
POST   /element-context/:id/attachments   — multipart upload (1+ files), 409 if pick already pulled
DELETE /element-context/:id/attachments/:attachmentId — remove before pull
GET    /element-context/:id/quota         — current month usage + remaining
```

**Env vars (new)**
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE` (optional, for non-signed URLs)

---

### 2. Edit picks before in_progress

Let users tweak a pick after sending — fix a typo, add a missing screenshot — as long as Claude hasn't pulled it yet.

**UX**
- Sidepanel history cards with `status === "not_started"` get an edit (pencil) affordance next to the ✕
- Clicking opens an inline modal in the sidepanel: prompt textarea + attachments list (add/remove)
- Save → `PATCH /element-context/:id` → card updates in place
- Cards in `in_progress` or `completed` show no edit affordance

**Server**
- New: `PATCH /element-context/:id` — accepts `{ prompt?, attachments?: { add: File[], remove: string[] } }`
- Returns `409 Conflict` if pick status has already been flipped to `in_progress` (Claude pulled it). Extension reacts by closing the modal and refreshing the card status.

---

### 3. Top-up packs

When a Pro user hits the 30-attachment monthly cap, give them a one-tap way to keep going without a plan change.

**Offer**
- **$5 = +25 picks-with-attachments** for the **current calendar month only** (no rollover)
- New Dodo product: `DODO_PRODUCT_TOPUP_25`
- Repeatable — buy multiple packs in one month if needed

**UX (extension)**
- When monthly cap is hit, the dialog (and the rate-limit banner) show two CTAs:
  - **Buy +25 ($5)** → Dodo checkout, redirects back to `/verified?topup=success`
  - **Upgrade to Max** → upgrade flow
- Settings panel shows "Attachments this month: X / 30 (+N from top-ups)"

**Server**
- `routes/auth.js` — webhook handler for top-up product: increments `attachments_bonus:<userId>:<YYYY-MM>` in Redis
- `getAttachmentQuota()` — limit = plan limit + bonus
- Bonus key TTL: end of current month + 7d grace

---

### 4. Max plan (display only — not building yet)

Pricing-page tease for a higher tier. UI only this round; no server work.

| | Pro | **Max (Coming soon)** |
|---|---|---|
| Picks-with-attachments / month | 30 | 100 |
| Max file size | 5 MB | 25 MB |
| Price | (existing Pro) | $6.99/mo or $69/yr |

- Add a third pricing card on `Home.jsx` and the `/upgrade` page
- Card is visually disabled with a "Coming soon" badge — no checkout link, no Dodo product yet
- Existing Pro features unchanged

---

### Files touched

**Server (new)**
- `server/lib/r2.js`

**Server (modified)**
- `server/lib/db.js` — add `attachments` table migration
- `server/lib/storage.js` — pick payload includes `attachments[]`; monthly counter helpers
- `server/lib/auth.js` — `PLANS` gains attachment caps + Max entry; `getAttachmentQuota()`
- `server/routes/element.js` — 3 new endpoints (upload, delete, quota) + `PATCH /element-context/:id`
- `server/routes/auth.js` — top-up Dodo product webhook + checkout endpoint
- `server/routes/mcp.js` — attachment URLs in tool output + auto-delete on `completed`
- `server/package.json` — `@aws-sdk/client-s3`, `multer`

**Extension**
- `extension/content.js` — paperclip button, drop zone, thumbnail strip, file input, edit-mode wiring
- `extension/sidepanel.js` — edit modal, attachment badges on history cards, quota UX, monthly usage line in settings
- `extension/styles.css` — attachment thumbnails, drop zone hover, edit modal styles

**Website**
- `website/src/pages/home/Home.jsx` — Max card + Pro feature list update (mention attachments)
- `website/src/pages/upgrade/Upgrade.jsx` — note about attachment quota on Pro

**Docs**
- `PLAN.md` — this section
- `CLAUDE.md` — strip stale `$19 one-time` line; update Plans table when shipping

---

### Phasing

Build top-down so each phase is testable end-to-end:

1. **Storage primitives** — `r2.js`, `attachments` table migration, `PLANS` updates with caps, monthly counter helpers in Redis
2. **Pick mutations** — attachment upload/delete endpoints + `PATCH /element-context/:id` (with 409 on already-pulled) + auto-delete on completed
3. **MCP integration** — attachments in tool responses with signed GET URLs; verify Claude can read images via URL
4. **Top-ups** — new Dodo product + webhook + bonus counter + checkout endpoint
5. **Extension UI** — floating-dialog paperclip + thumbnails + drop zone; sidepanel edit modal + quota strip
6. **Website** — Max card (display only) + Pro copy update
7. **Doc cleanup** — finalise PLAN.md, strip stale lines from CLAUDE.md, update Plans table

Phase 1 unblocks 2–4 in parallel; phase 5 needs 2 + 3 done; phase 6 + 7 can land any time after 1.

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
