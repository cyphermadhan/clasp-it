# Implementation Log

## [2026-09-09] — Add "Clear done" control for completed picks

- **What:** Added a way to bulk-clear completed ("Done") picks from history, both locally and server-side, so they stop occupying slots in the server's 10-pick ring buffer and crowding out picks the AI hasn't seen yet.
- **Files:** `server/lib/storage.js` (`removeCompletedPicks`), `server/routes/element.js` (`DELETE /element-context/completed`), `extension/sidepanel.html` + `extension/sidepanel.js` ("Clear done" link in history header), `CLAUDE.md` (docs).
- **Details:**
  - New route registered *before* `DELETE /:id` in Express so `"completed"` isn't swallowed as a pick ID.
  - No attachment-quota decrement on clear — completed picks already had attachments auto-purged (and counted against monthly usage) via `update_pick_status(completed)`; this endpoint's cleanup is just a defensive no-op in the normal case.
  - Root cause: `MAX_PICKS = 10` in `storage.js` caps the Redis list regardless of status, so old completed picks can evict not-yet-seen picks before Claude ever reads them via `list_recent_picks`/`get_element_context`.
