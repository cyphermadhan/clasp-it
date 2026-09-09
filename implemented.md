# Implementation Log

## [2026-09-09] — Fix "Clear done" resurrecting old completed picks; bump to v1.1.2

- **What:** Fixed "Clear done" bringing back a few already-cleared completed picks on the next hydrate. Bumped `extension/manifest.json` and the JSON-LD `softwareVersion` (`website/index.html`, rebuilt into `server/public/index.html`) to 1.1.2.
- **Files:** `server/routes/element.js` (`DELETE /element-context/completed`), `extension/manifest.json`, `website/index.html`, `server/public/index.html` (generated).
- **Details:**
  - Root cause: `removeCompletedPicks()` only purges completed picks still sitting in the Redis 10-pick ring buffer (shared across all statuses, so completed picks fall out of it quickly). The route only marked `deleted_at` in Postgres for whatever that Redis pass returned — any completed pick already evicted from the buffer kept `deleted_at IS NULL`, so the next `GET /element-context/recent` hydration (on sidepanel open) re-added it to local history, looking like old "done" items coming back.
  - Fix: the route now also queries Postgres directly for every completed, `deleted_at IS NULL` pick for the user, unions those ids with whatever the Redis pass found, and purges attachments (R2 + `attachments` rows) and sets `deleted_at` for the full set. Falls back to the Redis-only pass when `pool` isn't configured (dev, no `DATABASE_URL`).
  - Client (`sidepanel.js`) needed no changes — it only checks the fetch resolved, doesn't inspect the response body.

## [2026-09-09] — v1.1.1 approved on Chrome Web Store, confirmed live

- **What:** v1.1.1 passed Chrome Web Store review and is confirmed working end-to-end on a real install — "Clear done" and persistent history hydration both verified live, not just in local dev.
- **Files:** None (verification only).
- **Details:**
  - Permission justifications on the Developer Dashboard's Privacy tab were already complete/accurate for all declared permissions (`activeTab`, `scripting`, `storage`, `webRequest`, `sidePanel`, host permissions) — no changes needed there for this release.
  - Gotcha: the Store listing showing "1.1.1" doesn't mean an installed copy has it — Chrome's background update check can lag hours. Fix: `chrome://extensions` → enable Developer mode → click **Update** to force an immediate check. Worth remembering for future releases instead of assuming something's broken when a just-approved version doesn't show up right away.

## [2026-09-09] — Bump extension to v1.1.1, package for Chrome Web Store

- **What:** Bumped `extension/manifest.json` and the JSON-LD `softwareVersion` (`website/index.html`, rebuilt into `server/public/index.html`) to 1.1.1 to cover this session's "Clear done" + history-hydration changes. Built `clasp-it-v1.1.1.zip` (contents at zip root) ready for Developer Dashboard upload.
- **Files:** `extension/manifest.json`, `website/index.html`, `server/public/index.html` (generated).
- **Details:** Live store listing is at `chromewebstore.google.com/detail/clasp-it/inelkjifjfaepgpdndcgdkpmlopggnlk`; zip is untracked at repo root (build artifact, not committed).

## [2026-09-09] — Source history hydration from Postgres, up to plan's historyLimit

- **What:** `GET /element-context/recent` now sources from the persistent `picks` Postgres table (capped at `PLANS[plan].historyLimit` — free: 5, pro: 50, max: 200) instead of the AI's 10-pick Redis working set, so a second install actually sees full account history, not just whatever's left in the 10-slot buffer.
- **Files:** `server/lib/db.js` (new `element_label`, `deleted_at` columns), `server/routes/element.js` (`elementLabelFor` helper, POST insert, `/recent` Postgres branch + Redis fallback, `deleted_at` writes in cancel + clear-completed), `server/routes/mcp.js` (`update_pick_status` now writes `status` through to Postgres), `CLAUDE.md`.
- **Details:**
  - Wired up `historyLimit` in `PLANS` (`server/lib/auth.js`) — it existed but was never read anywhere before this.
  - Deletions are permanent from history's perspective: cancel (`DELETE /:id`) and "Clear done" (`DELETE /completed`) both set `deleted_at = now()` in Postgres, so cleared/cancelled picks never resurface via hydration on a fresh install — confirmed with the user this is the desired semantics over an immutable log.
  - Falls back to the pre-existing Redis-based listing when `DATABASE_URL` is unset, matching this repo's graceful-degradation convention.
  - No extension changes needed — response shape is unchanged, so `hydrateHistoryFromServer()` merges/sorts/slices exactly as before.

## [2026-09-09] — Hydrate local history from server on login

- **What:** A second install using the same API key (e.g. a locally-loaded dev copy) now pulls in the account's existing server-side picks on login/init instead of showing an empty history list.
- **Files:** `server/routes/element.js` (`GET /element-context/recent`), `extension/sidepanel.js` (`hydrateHistoryFromServer`, called from `init()` and `saveKey()`), `CLAUDE.md` (docs).
- **Details:**
  - Root cause: `chrome.storage.local` is scoped per extension install ID, not per account — the Chrome Web Store install and an unpacked dev copy never shared storage, even though both hit the same Redis-backed picks list server-side.
  - Merges by `pickId`, additive only — never drops local-only items that haven't been confirmed by the server yet (still mid-send).
  - Best-effort: silently no-ops on fetch failure so a flaky hydrate call never blocks login.

## [2026-09-09] — Add "Clear done" control for completed picks

- **What:** Added a way to bulk-clear completed ("Done") picks from history, both locally and server-side, so they stop occupying slots in the server's 10-pick ring buffer and crowding out picks the AI hasn't seen yet.
- **Files:** `server/lib/storage.js` (`removeCompletedPicks`), `server/routes/element.js` (`DELETE /element-context/completed`), `extension/sidepanel.html` + `extension/sidepanel.js` ("Clear done" link in history header), `CLAUDE.md` (docs).
- **Details:**
  - New route registered *before* `DELETE /:id` in Express so `"completed"` isn't swallowed as a pick ID.
  - No attachment-quota decrement on clear — completed picks already had attachments auto-purged (and counted against monthly usage) via `update_pick_status(completed)`; this endpoint's cleanup is just a defensive no-op in the normal case.
  - Root cause: `MAX_PICKS = 10` in `storage.js` caps the Redis list regardless of status, so old completed picks can evict not-yet-seen picks before Claude ever reads them via `list_recent_picks`/`get_element_context`.
