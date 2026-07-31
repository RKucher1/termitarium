# Changelog

## 0.1.0 — 2026-07-31

Initial release. Tested against numbat v0.1.1, record schema 0.2.0.

- Single-file viewer: virtual scrolling, query language, timeline scrubbing,
  cited-event resolution, live polling
- `numbatd`: loopback-only Go server with Host-header validation and
  whitelist file serving
- `numbat-prune`: retention with archive-before-delete and atomic replace
- `install.sh`: per-user install with launchd agents
