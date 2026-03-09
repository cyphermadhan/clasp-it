# Clasp It

Pick any element on any webpage and send it instantly to Claude Code via MCP.

```
Chrome Extension → POST https://api.clasp-it.com/element-context
Claude Code      → MCP  https://api.clasp-it.com/mcp
```

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
| `index.js` | Express app, CORS, mounts routes, starts on port 3001 |
| `routes/element.js` | `POST /element-context` — stores picks, returns `{ success, id }` |
| `routes/mcp.js` | `GET+POST /mcp` — MCP endpoint using `@modelcontextprotocol/sdk` |
| `lib/storage.js` | Redis ring buffer (last 10 picks per user, 24h TTL) with in-memory fallback for local dev |

**MCP tools exposed to Claude Code:**

| Tool | Description |
|------|-------------|
| `get_element_context` | Returns the most recent pick |
| `get_element_context_by_id` | Returns a specific pick by ID |
| `list_recent_picks` | Returns last 10 picks |
| `clear_context` | Clears all picks |

Auth is per `X-API-Key` header. Defaults to `"dev"` if no key is provided (local dev only).

---

## Quick Start (local dev)

**1. Start the server**
```bash
cd server
npm install
node index.js
# → clasp-it listening on port 3001 (in-memory storage)
```

**2. Load the extension**
- Chrome → `chrome://extensions` → Enable Developer Mode → Load unpacked → select `extension/`

**3. Add MCP to Claude Code**
```bash
claude mcp add --transport http clasp-it http://localhost:3001/mcp
```

**4. Use it**
- Click the Clasp It icon on any webpage
- Pick an element, type an instruction, hit Send
- In Claude Code: `get the element I just picked and apply the change`

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

## What's Next (Phase 2)

- User auth (magic link or GitHub OAuth)
- API key generation and validation
- Stripe integration (Free / Pro $9/mo / Team $29/mo)
- Plan-based feature gating (screenshot, console, network, React props on Pro+)
- Rate limiting (Redis)
- Website: landing page, pricing, dashboard
