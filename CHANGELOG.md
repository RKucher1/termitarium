# Changelog

## 0.2.0 — 2026-07-31

Viewer readability and live-stream fixes. No changes to `numbatd` or
`numbat-prune`.

- **Plain-language descriptions.** Every record now renders as a sentence —
  `Ran a shell command: npm test`, `Saw domain api.supabase.com, 3 times` —
  as the row's primary text, with the event type retained beside it and the
  description repeated at the top of the detail pane. The raw JSON is
  unchanged. Descriptions never claim what a record does not say: a
  `command.result` carrying no `exit_code` reports its duration instead of
  inventing success or failure. Free-text queries now search description text
  in addition to the raw line; field queries (`rule:`, `sev:`, …) still match
  raw fields only. The logic is pure and covered by `test/viewer-logic.js`.
- **Newest-first sort, switchable.** The list defaults to newest first, with a
  toggle in the query bar and an `s` key binding. Sorting reorders the view
  index only, so record indices, cited-event resolution, and the new-arrival
  highlight are unaffected. Records with no parseable timestamp always sort to
  the bottom in file order, in both directions. The timeline remains
  chronological left-to-right.
- **Live streaming is visible, and on by default.** New records were being
  fetched correctly but appended to the bottom of a file-ordered list, out of
  view for anyone reading from the top; newest-first sort puts them on screen,
  and the viewport now holds its anchor when arrivals push it down. A source
  served over loopback can be polled, so the viewer now streams it on load
  rather than waiting for a toggle; a file opened from disk has no URL to poll
  and stays static. Switching Live off is remembered and does not re-arm. The
  indicator dot reports poll state — off, nothing new (with last check time),
  `+N` arrived, or unreachable — and poll failures now surface instead of being
  swallowed. Polling continues in a backgrounded tab and catches up immediately
  on `visibilitychange`.
- Fixed the detail pane's `observed` block ignoring the `command` field, which
  hid shell commands behind the raw JSON.

## 0.1.0 — 2026-07-31

Initial release. Tested against numbat v0.1.1, record schema 0.2.0.

- Single-file viewer: virtual scrolling, query language, timeline scrubbing,
  cited-event resolution, live polling
- `numbatd`: loopback-only Go server with Host-header validation and
  whitelist file serving
- `numbat-prune`: retention with archive-before-delete and atomic replace
- `install.sh`: per-user install with launchd agents
