# Clasp-it — Setup Guide

> **Ask me anything about Clasp-it.** Drop this file into your project and ask your AI editor: _"How do I use Clasp-it?"_ or _"Why isn't my MCP connection working?"_ — they'll have everything they need to help you.

---

## What is Clasp-it?

Clasp-it is a Chrome extension + hosted MCP server that bridges your browser and your AI editor (Claude Code, Cursor, Windsurf, or any MCP-compatible tool).

You click any element on any webpage. Clasp-it captures everything your editor needs to make the right change:
- Full HTML and CSS selector
- Computed styles
- React component props (if detected)
- Console logs
- Network requests
- A screenshot of the element

All of that gets sent to your AI editor via MCP in one click. No copy-pasting. No describing what you see. Just click the element, type your instruction, and switch to your editor.

---

## Prerequisites

- Google Chrome (or any Chromium browser)
- An MCP-compatible AI editor (Claude Code, Cursor, Windsurf, or similar)
- A Clasp-it API key (from your welcome email or [claspit.dev](https://claspit.dev))

---

## Installation

### Step 1 — Load the Chrome extension

Since Clasp-it is currently in beta, it is not yet on the Chrome Web Store. You load it manually as an unpacked extension:

1. Download `clasp-it-extension.zip` from your welcome email
2. Unzip it to a **permanent folder** — do not delete this folder after loading, Chrome needs it to stay there
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** using the toggle in the top-right corner
5. Click **Load unpacked** and select the unzipped folder
6. The Clasp-it icon will appear in your extensions bar — pin it for easy access

### Step 2 — Add your API key to the extension

1. Click the Clasp-it icon in the toolbar — the side panel opens
2. Enter your email and follow the magic link, **or** paste your API key directly if you have it
3. Your API key is in your welcome email — it starts with `cit_`

### Step 3 — Connect your AI editor via MCP

Open the extension sidebar → Settings (gear icon) → **MCP server setup**. Select your editor for the exact setup command.

**Claude Code** — run once in your terminal:
```bash
claude mcp add --scope user --transport http clasp-it https://claspit.dev/mcp --header "Authorization: Bearer YOUR_API_KEY"
```

**Cursor** — add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "clasp-it": {
      "url": "https://claspit.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

**Windsurf** — add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "clasp-it": {
      "serverUrl": "https://claspit.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

**Any other MCP-compatible editor:**
- Endpoint: `https://claspit.dev/mcp`
- Transport: Streamable HTTP
- Auth header: `Authorization: Bearer YOUR_API_KEY`

Restart your editor after making changes.

To verify it's connected:
```bash
curl https://claspit.dev/auth/info -H "Authorization: Bearer YOUR_API_KEY"
```
Expected response: `{"email":"you@example.com","plan":"free"}`

---

## How to use Clasp-it

### Basic pick flow

1. Open any webpage in Chrome
2. Click the Clasp-it icon to open the side panel
3. Click **Pick Element**
4. Hover over elements — they highlight as you move
5. Click the element you want to work on
6. A floating prompt dialog appears next to the element
7. Type your instruction (e.g. _"make this button larger"_, _"fix the spacing"_, _"change to primary style"_)
8. Press **Enter** or click the send button
9. Switch to your AI editor
10. Say: **"fix all recent picks using clasp-it"** or **"fix the element I just picked"**

### What your editor receives

Each pick contains:
```json
{
  "element": {
    "selector": "nav > ul > li:nth-child(2) > button",
    "tagName": "BUTTON",
    "classList": ["btn", "btn-primary"],
    "innerHTML": "...",
    "computedStyles": { "backgroundColor": "...", "fontSize": "14px", ... },
    "dimensions": { "width": 120, "height": 36 }
  },
  "prompt": "make this button larger",
  "pageURL": "http://localhost:3000/dashboard"
}
```

Pro users also get: `screenshot`, `consoleLogs`, `networkRequests`, `reactProps`.

### MCP tools available

| Tool | What it does |
|------|-------------|
| `get_element_context` | Fetches the latest pick |
| `get_element_context_by_id` | Fetches a specific pick by ID |
| `list_recent_picks` | Lists your last N picks (default 10) |
| `update_pick_status` | Marks a pick as not_started / in_progress / completed |
| `clear_context` | Clears all your picks |

### Useful prompts

- _"Fix all my recent clasp-it picks"_
- _"Fix the element I just picked"_
- _"List my recent clasp-it picks and fix the ones marked not_started"_
- _"The button I picked — change its variant to primary"_

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
| Price | Free | $2.99/mo or $24/yr |

Upgrade at [claspit.dev/upgrade](https://claspit.dev/upgrade).

---

## Troubleshooting

### Extension sidebar shows "Invalid API key"
- Re-paste your API key from the welcome email
- Make sure there are no leading or trailing spaces
- Try signing out (gear icon → Sign out) and re-entering the key

### MCP not responding in your editor
1. Test your key: `curl https://claspit.dev/auth/info -H "Authorization: Bearer YOUR_KEY"`
2. If you get `{"error":"Invalid API key"}` — re-authenticate in the extension
3. If you get `{"error":"Missing X-API-Key or Authorization header"}` — the MCP command wasn't set up correctly. Remove and re-add using the setup instructions in the extension settings.
4. Restart your editor after making changes

### Extension not capturing elements on a page
- Refresh the page first — the content script sometimes needs a fresh injection
- Chrome built-in pages (`chrome://`, `chrome-extension://`) cannot be injected — this is a browser restriction
- Some pages with strict CSP headers may also block injection

### "10/10 free picks used today"
Free plan is limited to 10 picks per day. The limit resets at midnight. Upgrade to Pro for unlimited picks at [claspit.dev/upgrade](https://claspit.dev/upgrade).

### The floating prompt dialog doesn't appear after clicking an element
- Make sure the side panel is open before picking
- Try refreshing the page and picking again
- Check the browser console for errors

---

## FAQ

**Can I use Clasp-it with multiple projects open at the same time?**
Yes. `list_recent_picks` returns picks from all sessions. You can filter by `pageURL` or just use `get_element_context` to get the most recent pick.

**Is my data stored on your servers?**
Pick context (HTML, CSS, your prompt) is stored in Redis with a 24-hour TTL, then deleted automatically. Screenshots are never stored server-side — they are captured, sent in the POST request, and discarded.

**How do I update my API key?**
Remove the existing MCP server config and re-add it with the new key. For Claude Code:
```bash
claude mcp remove clasp-it
claude mcp add --scope user --transport http clasp-it https://claspit.dev/mcp --header "Authorization: Bearer NEW_KEY"
```
For Cursor/Windsurf, update the key in the respective JSON config file and restart the editor.

**Can I use the extension on localhost?**
Yes — Clasp-it works on any page Chrome can load, including `http://localhost:3000`.

**How do I update the extension when a new version is released?**
Download the new zip, unzip it to the same folder (overwrite), then go to `chrome://extensions` and click the refresh icon on the Clasp-it card.

---

## Support

Reply to your welcome email or write to [dev@madhans.world](mailto:dev@madhans.world).

We read every message — especially bug reports and feature requests from beta users.
