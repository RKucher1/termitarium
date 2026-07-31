# numbat-tools

A local viewer, a hardened localhost server, and a retention tool for
[numbat](https://github.com/perplexityai/numbat) record streams.

numbat writes NDJSON. It does not ship a UI. This fills that gap without
sending anything anywhere.

> Not affiliated with or endorsed by Perplexity AI. "numbat" is their project;
> this is an independent companion toolkit that reads its output format.

**Tested against numbat v0.1.1, record schema 0.2.0.** The schema is young and
will move; check \`CHANGELOG.md\` for the version this tracks.

![viewer](docs/screenshot.png)

---

## What's here

| | |
|---|---|
| `viewer/viewer.html` | Single-file record viewer: virtual scrolling, query language, timeline scrubbing, cited-event resolution |
| `numbatd/main.go` | ~150-line Go server that serves the viewer and whitelisted `*.ndjson` over loopback |
| `prune/numbat-prune` | Retention tool: archive-before-delete, atomic replace, never loses a record |
| `install.sh` | Per-user install, builds the binary, wires launchd |

## Install

```sh
git clone https://github.com/YOURNAME/numbat-tools
cd numbat-tools
./install.sh
nb
```

Requires Go and Python 3 (both already present on a typical macOS dev box).
Everything installs under `$HOME`. No sudo. `./install.sh --uninstall` reverses
it and leaves your records alone.

## Use

```
nb              open the viewer
nb status       is the daemon up? what is it serving?
nb prune -n     dry-run retention, change nothing
nb prune        apply the 30-day window
nb logs         tail the daemon log
nb help         full command list
```

## Viewer

Opened at `http://127.0.0.1:8787/`, it asks the daemon for the source list and
loads your primary record file automatically — no file picker.

- **Query language** — `rule:chain sev:high agent:claude-code`, with `-` to
  negate. Fields: `rule` `sev` `agent` `type` `event` `session` `id`. Anything
  unprefixed is free text over the raw line.
- **Timeline** — density plot with findings overlaid; drag to filter to a time
  window.
- **Cited events** — findings resolve `cited_event_ids` into jump buttons, so a
  sequence match is two clicks from the commands behind it.
- **Live** — polls with HEAD requests, re-downloads only on change. Filters,
  time range, and selection survive each refresh.
- **Copy jq** — translates the current filter state into an equivalent `jq`
  command for scripting.

Keys: `/` search · `j`/`k` move · `g`/`G` ends · `r` reload · `l` live · `esc`
clear.

Virtualized rendering, chunked parsing, and a cached lowercase index per record
keep it responsive on large files. All output is HTML-escaped — agent command
text is untrusted input.

## Security posture

The threat model for a localhost service is *other processes on the machine and
hostile pages in your browser*.

- **Loopback only.** Refuses at startup to bind anything else.
- **Host-header validation.** Requests whose `Host` is not a loopback name get
  403. This closes DNS rebinding — the one practical way a remote site reaches
  a localhost service.
- **No CORS headers, ever.** A malicious page can send a request to 127.0.0.1
  but the browser will not let it read the response.
- **Whitelist serving.** Only `[A-Za-z0-9._-]*.ndjson` in the data directory,
  with symlink resolution checked against the root. No directory listing.
  GET/HEAD only.
- **No authentication, deliberately.** Any process running as you can already
  read the data directory off disk; a token would be ceremony, not a boundary.

Idle footprint is one ~6 MB process.

### Your records are sensitive

`records.ndjson` contains agent commands, prompts, project paths, hostname, and
username in plaintext. The `.gitignore` here blocks every NDJSON pattern —
**do not remove those rules**, and check `git log --stat` before your first push
if you have been working in the data directory.

## Retention

`numbat-prune` trims record files to a window and gzip-archives what it removes.

```
numbat-prune -n                dry run
numbat-prune -d 14             14-day window
numbat-prune --no-archive      discard instead of archiving
numbat-prune --archive-days 90 also drop archives older than 90 days
```

Guarantees, each verified against a fixture containing malformed lines, records
with no timestamp, and records with unparseable timestamps:

- Records with no parseable timestamp are always kept.
- Malformed lines are always kept, preserved verbatim.
- Archiving happens **before** removal; if it fails, the original is untouched.
- Replace is atomic (`os.replace` on a same-directory temp file).
- Permissions are preserved. Idempotent. Kept + archived always equals the
  original record count.

numbat itself never rotates its output, so something has to.

### Race with live hooks

Prune rewrites the file while agent hooks may be appending. Hook processes are
short-lived, so the window is small, but a hook firing during the swap writes to
the old inode. Prune when agents are idle. The weekly launch agent defaults to
Monday 9am for that reason.

## Docs

- \`docs/architecture.html\` — how the three pieces fit together: request flow,
  the loopback security boundary, the viewer's parse pipeline, prune's swap order
- \`docs/walkthrough.html\` — what numbat itself does, its three capture paths,
  monitor vs enforce, and the shipped rule catalog

## License

MIT. See `LICENSE`.
