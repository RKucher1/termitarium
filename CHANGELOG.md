# Changelog

## 0.4.0 — 2026-07-31

Installer correctness, a real favicon, and the bugs found looking for more of
the same failure.

- **The repo could not be installed.** `install.sh` builds `numbatd` with
  `go build`, but there was no `go.mod` anywhere in the tree, and Go 1.16+
  refuses to build outside a module. Every fresh clone failed at the build
  step — in the exact command the README tells people to run. Added
  `numbatd/go.mod`.
- **`/favicon.ico`, served for real.** Safari ignores SVG favicons supplied as
  `data:` URIs, so the inlined icon left it showing a generated placeholder.
  numbatd now serves a 163-byte PNG at a fixed path. The viewer declares both:
  the inline SVG is the only one that works over `file://`, the PNG is the only
  one Safari will use. The route joins a compile-time constant to `-dir`, so no
  part of the request reaches the filesystem, and it sits behind the same Host
  check, GET/HEAD restriction and `nosniff` header as everything else.
  `tools/gen-favicon.py` regenerates the PNG from the SVG's geometry.
- **Migration off the old launchd labels.** An install from before the rename
  left `com.numbat-tools.*` agents behind. Installing again would not have
  replaced them — it would have stacked a second daemon on the same port, and
  `--uninstall` would have removed the new pair while leaving the old one
  running. `install.sh` now unloads and removes the legacy pair before bringing
  the new agents up, says so when it does, and `--uninstall` covers both sets.
- **`launchctl load` lies.** Loading an already-loaded agent prints
  `Load failed: 5: Input/output error` and still exits 0, so the plist on disk
  changed while launchd kept the old definition and the script reported success.
  Reloads now use `bootout`/`bootstrap`, which return honest exit codes, with
  the legacy pair as a fallback — and neither is trusted: the result is
  re-checked against `launchctl list`.
- **A check that only failed when the answer was yes.** `is_loaded` was
  `launchctl list | grep -q`. Under `set -o pipefail`, `grep -q` exits at the
  first match, `launchctl` dies of SIGPIPE, and the pipeline returns 141 — so a
  loaded agent reported as missing. It is a here-string now.
- **Install verifies instead of announcing.** It checks the daemon by asking it
  to serve, the prune agent by asking launchd whether it registered, and the
  icon by fetching it; it exits non-zero if any of them failed. It no longer
  prints "installing fish function" on machines with no fish config, and
  confirms the file was written before claiming it installed one.
- **`--uninstall` finishes the job.** It removes the fish function and the icon
  as well as the binaries and plists, covers legacy labels, and refuses to
  report success while any of its agents are still loaded.
- Added `test/install-logic.sh` — 37 checks over migration ordering, idempotency,
  uninstall coverage, the build, and the icon. The suite overrides the launchd
  labels: `launchctl` is not scoped by `HOME`, so a sandboxed `HOME` does not
  sandbox launchd, and an earlier version of these tests took the live daemon
  down. It now asserts the real agent is still running when it finishes.
- Removed two literal control bytes from `test/viewer-logic.js`. They made
  `file` classify the source as binary, which made `grep` skip it silently — a
  search that finds nothing looked exactly like a search that refused to look.
- Viewer assertions now cover both icon declarations and the PNG's validity;
  304 assertions total.

## 0.3.0 — 2026-07-31

Per-finding interpretation. No changes to `numbatd` or `numbat-prune`.

- **Findings are interpreted from the record, not described by a fixed
  paragraph.** Every finding used to carry the same static caveat, which is
  read once and ignored afterwards. Selecting a finding now answers four
  questions about that specific record: what the rule looks for, what it saw
  here, why it fired, and what the record does and does not establish. It stays local and
  deterministic — no model call, no network, no new dependency.
- **An embedded rule catalog.** A finding carries its rule's `title` but not
  the `description` that says what the rule actually looks for, so the viewer
  embeds 51 rules generated from numbat's source by the new
  `tools/gen-rule-catalog.js`. The generated block records the numbat commit it
  was read from — a release tag is not enough, since many commits share one.
  The tool is maintainer-only: the viewer is still a single self-contained file
  with no build step. Rule text is © the numbat authors, Apache-2.0, attributed
  in the generated header and in `README.md`.
- **Version drift degrades visibly.** Records carry `rule_version`. When it
  disagrees with the embedded catalog the description is still shown — a bump
  usually refines a pattern rather than changing intent — but it is marked.
  The marker names both versions and does not claim the catalog text is merely
  older: a `--rules-dir` rule replaces a shipped rule by id, so the catalog may
  be describing a different rule entirely.
- **The interpretation claims only what the record supports.** The previous
  static note asserted that hook records describe a *proposed* action; that is
  true only sometimes. numbat registers both `PreToolUse` and `PostToolUse`, so
  `source_type: hook` proves nothing about ordering on its own. Only
  `command.exec` under a live hook now carries the "seen before it ran" claim;
  `file.write` and `file.delete` arrive from both sides and claim no ordering;
  an at-rest `artifact` finding says it was reconstructed after the fact.
  `observed_actor` speaks only for `assistant` and `user`, and is silent when
  absent. A chain rule states that numbat *observed* its steps in that order,
  and explicitly not that data flowed between them.
- **Rule text is treated as untrusted.** The catalog becomes executable
  JavaScript inside a `<script>` element, so the generator emits values as JSON
  and then escapes `< > & *` and U+2028/U+2029, which is what actually prevents
  `</script>` from closing the element early. It re-parses its own output and
  fails the build on any mismatch. It refuses symlinks, never reads outside
  `--rules-dir`, and never executes what it reads. A hostile rule fixture
  covers this.
- **Two fields the interpretation refuses to over-read.** `confidence` grades
  how directly evidence backs the observation — hook events are capped at
  `medium` because the evidence is the agent's own report, not a durable
  artifact. It is not uncertainty about the match, since rule evaluation is
  exact, and it is not a probability of harm; the 0.2.0 note calling it "parser
  certainty" was closer, and an earlier draft of this change called it match
  certainty, which was wrong outright. `observed_actor` is a classification
  numbat applies by construction rather than an observation, so `assistant` now
  reads as "the agent issued this as a tool call — the operator may still have
  asked for it or approved it" instead of asserting the operator was uninvolved.
- **A chain finding says which step it is showing.** `observed_*` on a sequence
  match is the completing event only, so the shown command is labelled as the
  final step, and the pre-action line no longer implies the whole chain was
  caught before it ran — the earlier steps had already happened.
- **Rule text can no longer corrupt the viewer on a later regeneration.** A
  description containing this file's own `[rulecat:end]` marker passed every
  check and shipped inertly, then spliced the block on the next run and left
  stray tokens in the viewer's only `<script>` — a syntax error that broke the
  whole page. `*` is now escaped, so rule text cannot spell a comment marker,
  and the block is rejected if a marker appears twice. The round-trip check
  also compares per rule id instead of whole-object, so a rule whose id sorts
  differently from its filename no longer aborts the build with a misleading
  "escaping defect" error. Rule ids that would poison an object literal
  (`__proto__`, `constructor`, `prototype`) are rejected rather than silently
  dropped, and the parser now reads block-style YAML lists and refuses inline
  comments, wrapped lists, quoted list items and escaped quotes instead of
  mis-reading them.
- Multi-line commands keep their line breaks in the interpretation; folding a
  shell script onto one line ran its heredoc body into the command and made the
  summary harder to read than the raw record.
- The viewer declares its own inlined SVG icon, which removes the `favicon.ico`
  404 every page load produced. Source kept at `viewer/favicon.svg`.
- Extended `test/viewer-logic.js` to 295 assertions. Interpretation fixtures are
  built from the embedded catalog rather than hand-written, so a regeneration
  that changes a rule's text cannot pass unnoticed. The `99.0` override in
  `~/numbat-policy` is covered as a unit case; note it is `enabled: false`, and
  numbat excludes disabled rules from the compiled engine, so it cannot
  actually emit a finding — the staleness path has no real-corpus coverage.

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
- **All times are local.** Row timestamps were sliced straight out of the UTC
  ISO string while the timeline axis and range pills used local time, so the
  same record appeared to occur at two different times — five hours apart on
  US Central. Rows and the detail pane now render from the parsed epoch in the
  viewer's timezone, and the detail timestamp carries its zone abbreviation.
  The raw JSON still shows the original UTC value.
- **Enforcement and finding records describe as numbat actually emits them.**
  Real enforcement records carry `decision: "no_override"` with `mode`,
  `reason` and a `rule_ids` array; the `deny_rule_id` field in the schema docs
  does not appear in practice. Monitor-mode decisions now read `Did not
  intervene (monitor mode): <rule>` rather than echoing raw identifiers,
  multi-rule records summarise as `<first> +N more`, and findings fall back to
  `rule_ids` when `rule_id` is absent.
- Fixed the detail pane's `observed` block ignoring the `command` field, which
  hid shell commands behind the raw JSON.
- Added `test/viewer-logic.js` — 135 assertions over the description logic,
  run with `node test/viewer-logic.js`. No dependencies, no build step; it
  lifts the pure block out of `viewer.html` and fails loudly if that block
  ever reaches for the DOM or a global.

## 0.1.0 — 2026-07-31

Initial release. Tested against numbat v0.1.1, record schema 0.2.0.

- Single-file viewer: virtual scrolling, query language, timeline scrubbing,
  cited-event resolution, live polling
- `numbatd`: loopback-only Go server with Host-header validation and
  whitelist file serving
- `numbat-prune`: retention with archive-before-delete and atomic replace
- `install.sh`: per-user install with launchd agents
