# Implementation Log

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
