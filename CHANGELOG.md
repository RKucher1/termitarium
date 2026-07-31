# Changelog

Releases 0.2.0 through 0.5.0 were tagged retroactively, after the fact, at the
commit where each version's notes below were completed. Only `v0.1.0` was
tagged at the time.

## 0.6.0

Events get the treatment findings already had. A finding got four explanatory
sections; an event got a one-line description, a raw command block, and a JSON
dump — and events are 6,715 of the 6,839 records in the reference corpus, so
the overwhelming majority of what an operator reads was the least explained
thing in the app.

- **`explain(record, index)` — per-event interpretation.** Four sections,
  adapted per event type: what this is, what happened next (or what this
  responds to), any findings that cite it, and what the record does and does
  not establish. Rendered in the same slot as the finding interpretation, above
  `OBSERVED`; the raw command block and `FULL RECORD` are untouched. Sections
  are omitted when the record has nothing to put in them, so a `command.result`
  with one useful fact gets three short lines rather than a padded template.

  `interpret()` is pure over one record because a finding carries its own rule
  id and observed fields. An event carries neither: what it means depends on
  the records beside it. Rather than reach for a global, `explain()` takes an
  index built once by `buildIndex()` and passed in — the same shape `rollup()`
  already uses for bucketed sessions. Both functions live in one marked block,
  so the pure surface stays liftable and the tests build fixtures from object
  literals instead of mocks.

- **The reverse citation index.** `cited_event_ids` only ran finding→event.
  An event now knows which findings cite it, names the rule, and links to it —
  the mirror of the jump buttons findings already had. The relation is treated
  as many-to-many; it is one-to-one in this corpus and nothing depends on that.

- **Four pair shapes, not two.** `tool_call_id` was assumed to join
  `command.exec`↔`command.result` and `tool.call`↔`tool.result`. The corpus
  says otherwise: `tool.result` (1,268) mostly answers *file* events —
  `file.write` (637) + `file.read` (547) + `tool.call` (84), summing exactly.
  All four shapes are handled.

- **`file.read` and `file.write` no longer imply a completed operation.** In
  all 3,228 pairs in the corpus the call side precedes the result side, without
  exception, so these events are the request, not the outcome. The explanation
  says *asked to write* and states that the record does not show whether the
  write completed — the same correction `command.exec` received when *Ran*
  became *Proposed*. `describe()`'s row text was corrected to match, once a
  cold reviewer showed the two panes disagreeing on screen (below).

- **A missing result is never rendered as failure.** 13 of 1,973 proposed
  commands have no `command.result`, and 12 of those 13 are mid-session — so
  the absence is not truncation either. The pane says no result was recorded
  and that this shows neither failure nor execution. No record in the corpus
  carries an `exit_code` at all; where one exists the pane reports it, and
  where none does it says whether the command succeeded is not recorded.

- **Session context survives record selection.** Narrowing to a session and
  clicking any row silently discarded the rollup, with no way back except an
  isolate button buried in whichever record happened to be clicked — which
  reads as a missing feature rather than as navigation. The pane header now
  keeps a labelled return to the summary whenever the view is one session.
  Persisting the whole rollup above every record was the alternative; it would
  push the explanation below the fold on every selection and re-render a rollup
  per arrow-key press.

- **Join keys are refused rather than truncated.** Record-derived keys are
  bounded, as elsewhere — but truncating a *join* key can fuse two distinct ids
  into one pair, and a fabricated pair is a worse failure than no pair. Keys
  over 200 characters are not indexed. The longest real `tool_call_id` in the
  corpus is 30 characters. Index maps are null-prototype, so a record whose id
  is `__proto__` cannot reach `Object.prototype`.

Four cold reviewers then read the finished state with no memory of how it was
built — coherence, security, honesty of claims, and actionability — and between
them found enough to change the design.

- **The caveat section was 60% constant text, so it taught the eye to skip.**
  Measured over the corpus: the four most repeated strings were 59.9% of all
  explanation output, and the `confidence` bullet alone was 25% — on 100% of
  panes, always last, explaining a field that has one value (`medium`) across
  all 6,715 events. A constant sitting where the rare real caveat lives is
  worse than nothing: it trains the reader past the eight `permission.requested`
  records whose caveat is real. The bullet is gone; the value is still a header
  tag. The `sub_agent` note went from 174 characters to 120, and the headline
  now names the subagent, which no other line in the pane did. Output is down
  from 576 to 406 characters per record.

- **The headline duplicated the row summary verbatim on 1,268 records.** Every
  `tool.result` opened with the summary line's own sentence plus a period. It
  now reports what the record does *not* carry — no `tool.result` in the corpus
  carries any payload — which is the operator's next question. Exact-duplicate
  headlines: 1,268 → 0.

- **The pair was computed and then thrown away.** `exPairOf()` located the
  counterpart and the pane only described it, leaving the operator to find it by
  hand. It is a jump button now, like a finding's cited events.

- **Four claims that were true of this corpus but unverified in the code.**
  The forward branch named the counterpart type it *expected* rather than the
  one it *found* (a `file.read` joined to a `command.result` announced a
  `tool.result` that was not there); the backward branch took its verb from the
  subject, so a result paired with a result was described as "where the command
  was proposed"; `tool_error` was attributed "only" to the agent's own marker,
  which the project's own README says is false for OTLP records; and
  `exit_code` was accepted only as an integer, so a float produced "carries no
  exit code" while `describe()` rendered it happily.

- **Three different absences were being reported as one.** A record with no
  `tool_call_id`, a record whose key this viewer declines to index, and a record
  whose counterpart is genuinely missing are now distinguished. Reporting an
  indexing limit as "does not appear in this file" is a fabricated absence —
  the same class of error as a fabricated pair, and in a forensic tool a
  serious thing to say about a record sitting two rows away. Where several
  records share one key, the pane declines to name any of them.

- **`explain()` called a chat message a tool call.** The actor caveat was gated
  on `actor === "assistant"` alone, so it fired on all 53 `message.assistant`
  records — the agent writing prose to the operator — telling the reader it was
  "issued as a tool call", directly under a headline that correctly said
  otherwise. Now gated on event type. Likewise `decision: "asked"` was announced
  as an approval decision and then contradicted in the next clause; "asked" is
  the marker that a decision was *requested*.

- **`describe()` was the outlier, and its own pane now contradicted it.** The
  "don't imply what the record doesn't establish" rule had been applied to
  `command.exec` and swept for nowhere else. `Wrote a file` asserted a completed
  write on 637 records while the explanation directly beneath said the record
  does not show whether the write completed; `Session started` was asserted for
  107 boundary events that belong to a subagent, not the session; and
  `Command finished successfully` was the one verdict left anywhere in the
  product. All three corrected.

- **`tool_error` is now visible in the row list.** 32 records carry the only
  failure signal in the corpus, and finding them meant opening records one at a
  time.

The security pass attacked every new render path rather than reading it, and
found four real defects plus a pre-existing one. No XSS was found: a 160-byte
polyglot placed in eighteen different fields across every affected record
produced zero injected nodes, zero `on*` attributes, and zero dialogs in real
Chrome — `esc()` held as the single escape point.

- **Two lookup tables were read with a bare `[]`.** Every `Object.prototype`
  member name is a legal `event_type`, so a record typed `constructor` or
  `toString` was treated as a known type: it gated a whole "What this responds
  to" section on and told the operator the requesting event was *missing from
  this file* — a fabricated absence, in the one function whose comment forbids
  exactly that. The same defect in the mate-selection loop let a decoy record
  typed `toString` displace a genuine `command.exec`, so a result was described
  as answering the decoy and the decoy's path was attributed to it, while a
  `curl … | sh` sitting on the same key was never shown. Both now go through
  `hasOwnProperty`.

- **Join keys were whitespace-normalised, so a trailing space forged a pair.**
  `"abc"` and `"abc "` indexed to the same record. The same normalisation
  desynced these keys from the id indexes the viewer builds over the raw
  `event_id`, which silently broke jump buttons. Keys are now matched exactly,
  and anything carrying whitespace or a control character is refused.

- **The per-key cap suppressed evidence silently.** Eight cheap decoy records
  sharing one `tool_call_id` pushed the genuine `command.result` out of the
  index, so a `tool_error` — the only failure signal these records carry — was
  dropped without a word. Bounding is right; doing it silently is not. A
  truncated key now says the counterpart named may not be the right one.

- **A finding's cited events were rendered without a cap.** `buildIndex()`
  bounds the same list; the render loop 200 lines away did not, and it wired a
  listener per button. A finding citing 2,000,000 events — a 24 MB file, well
  under the size guard — built two million DOM nodes and froze the tab for
  80–112 seconds, on every selection. Capped at 200, with the remainder stated.
  Measured after the fix on the reviewer's own repro: **826 ms**. Pre-existing,
  in the function the new code was added to.

- **Record content could author a sentence.** `sub_agent` becomes the subject of
  the headline, so a value of `operator, not the agent,` rendered "The operator,
  not the agent, subagent proposed a shell command." Escaped, so never
  injection — but a forensic pane must not let a record write its own prose.
  Only an identifier-shaped value is inlined now.

- Verified by execution: 615 unit assertions, fourteen deliberate mutations
  confirming the assertions that matter actually fail when the behaviour
  breaks, all 6,715 events explained against the real corpus with no blank
  section and pair and citation counts agreeing with independent `jq`, 40
  checks driving real Chrome — including `ROW` measured at exactly 29px in the
  live DOM and a hostile record whose command is `<img src=x onerror=…>`
  rendering as text with no node, no handler, and no prototype pollution.

## Unreleased

Corrections to the public surface, found by re-reading it against the code
rather than against the previous draft.

- **The viewer no longer claims a proposed command ran.** `describe()` rendered
  `command.exec` as *Ran a shell command* while `interpret()`, one pane away
  about the same record, said numbat saw it before it ran and cannot show
  whether it executed. It says *Proposed* now. Alongside: `dsDur()` cascaded
  from minutes to nothing, showing a four-hour command as "267 min" while the
  rollup called the same span "4h 27m"; map keys built from record content were
  unbounded, so one record with a 300 KB `source_agent` inflated the pane; and
  the header record count could exceed the sum of the grid because
  `permission.requested` and `network.indicator` had no cell — they are counted
  as *other records*, and the parts now sum to the whole, asserted in the tests.
- **Three false statements in the walkthrough**, untrue against numbat v0.1.1: a
  token count on `prompt.user` (numbat records none, anywhere), a
  `config.change` event type (the vocabulary has `config.agent` and
  `config.mcp`, and a `settings.json` edit arrives as `file.write`), and "five
  record types" with an exhaustive five-way decoder — there are six, and a
  parser written from that sentence falls through on `diagnostic`. The sample
  stream also advertised `exit 0`, the one field a hook-captured
  `command.result` almost never carries.
- **The architecture diagram described a shape the daemon outgrew** — three
  routes and one directory, when numbatd answers four across two. It also
  gained the two limits that matter most and were absent: that success is not
  in the data, and that subagents are not separate sessions. Separately, the
  README told every reader to run `nb`, a fish function written only when
  `~/.config/fish` exists, so the install block ended on a command most readers
  could not run.

Below: one behaviour change — the size guard, which the sweep found by checking
a documented promise against the code and discovering the promise was the only
part that existed — and the documentation corrections that came with it.

- **The security posture claimed a boundary that does not exist.** The
  architecture page stated that "other users" were among the boundaries covered
  by the daemon's gates. They are not. `numbatd` has no authentication and no
  peer-credential check — the whole request gate is a Host-header match and a
  method restriction — and a loopback port is reachable by every uid on the
  machine. numbat writes its records `0600`, so starting the daemon *widens*
  access to files that were owner-only on disk. The argument that "any process
  running as you can already read it off disk" was true of the premise and
  false of the conclusion. Both the README and the architecture page now say
  plainly that this is a single-user-machine tool. The correction is careful in
  the other direction too: the whitelist, symlink and method checks do still
  bound a local caller to `*.ndjson` inside `-dir` — what is missing is any
  notion of *who* is asking. The suggested remedy is a Unix-domain socket,
  since a TCP listener has no peer-uid to check.
- **The size guard now runs on the path everyone uses, and at a limit that can
  actually fire.** The architecture page promised that files past 900 MB are
  rejected "rather than hanging the tab." Two things were wrong. `MAX_BYTES` was
  only checked on the file-picker path — `loadURL()` and the live-poll refresh,
  which is how the viewer loads on open and on every arrival, fetched and
  buffered the whole response with no size check at all, though `/api/sources`
  had already reported the size. And 900 MB sits *above* V8's maximum string
  length of 2^29-24 bytes, so even on the path it guarded it could not fire
  before the engine did. The limit is now 480 MiB, below that ceiling by
  construction and asserted so in the tests; both served paths check
  `Content-Length` before reading a byte of the body, and a response carrying no
  length is not refused, because a guess is worse than none. Extracted as a
  `[sizeguard]` block with `overSize()` and `hdrSize()`, pure and lifted into
  the unit tests like `describe()`, `interpret()` and `rollup()` before it.
  Verified by execution against a real 500 MB stream served by `numbatd` — a
  size that is under V8's ceiling and over the new limit, so it is exactly the
  case the old guard let through and the tab died on.
- **`confidence` was described wrongly in the walkthrough**, in two places, and
  contradicted this repo's own README — which had it right. numbat grades how
  *directly* evidence backs an observation; only `low` concerns parse quality.
  "Parser certainty" was the 0.2.0 wording, retired in 0.3.0 in the README and
  never carried across to the walkthrough.
- **Ambiguity does not uniformly suppress a deny.** The walkthrough listed
  "missing sequence state" alongside decode errors and panics as something that
  suppresses enforcement. numbat does the opposite deliberately: unavailable
  state skips sequence rules and lets an otherwise clean stateless deny through.
  An operator reading the old sentence would have expected to be let past.
- **"numbat never rotates or truncates its own output"** is true of the hook
  capture and false as a blanket statement — `numbat scan --output file
  --output-file PATH` truncates `PATH` on every run. Corrected at all four
  sites, one of which the first pass of this sweep missed.
- Smaller overstatements corrected: `tool_error` is set only from an
  agent-supplied field *on the hook path*, but can be inferred from log
  severity over OTLP; the bind check accepts `localhost` and `::1`, not just
  `127.0.0.1`, and `localhost` is a name the resolver controls, so "you cannot
  misconfigure it even deliberately" was too strong — the same overclaim was in
  `numbatd/main.go`'s own header comment; the HTTP sink retries on the next
  write after 30 seconds rather than on a background timer, and drops under
  buffer pressure rather than "retrying once"; `tamper.detector_state_write`
  matches enumerated write patterns rather than "anything that writes"; prune
  keeps malformed lines but re-encodes as UTF-8 with replacement and normalises
  line endings, so it is not byte-identical and "verbatim" had to go; blank
  lines are dropped and excluded from the kept-plus-archived invariant, which
  the architecture page stated without that qualification; `numbat collect` is
  a long-running receiver, so "not a daemon" became "no daemon by default"; and
  the whitelist regex quoted in the docs was looser than the one in the code.
- `tools/gen-rule-catalog.js` said "nothing is require()d, eval()d or executed"
  under a SECURITY header while shelling out to `git` three times for
  provenance. No rule content reaches those calls, but git honours
  repository-supplied config, so the claim is now scoped and the caveat stated.

## 0.5.0 — 2026-07-31

Session rollup. A finding explains itself and an event explains itself; a
session did not, and the only way to understand one was to filter by
`session_id` and scroll a thousand rows.

- **`rollup()` — what one session did.** Narrow the view to a single session
  and the detail pane summarizes it in place of the placeholder: span and
  whether it terminated, commands proposed against results observed, tool
  events, files read and written (deduplicated by path), findings by severity
  and rule id, enforcement decisions by value, subagent activity, the endpoint
  it ran on, and the prompt that started it. Pure, self-contained between
  markers, and unit tested like `describe()` and `interpret()` before it.
- **It refuses to tell you the session succeeded.** numbat's schema defines an
  optional `exit_code`, but no record in the reference corpus carries one, so a
  `command.result` in practice reports `duration_ms` and nothing more. Where
  exit codes are absent the rollup says so; where only some records carry one
  it states the coverage rather than going quiet, so a single code cannot imply
  the rest were accounted for. A command with no matching result is stated as
  *no result was recorded*, never as a failure — and whether it might still be
  running is decided per session, because an unpaired command at the tail of a
  session with no recorded end may genuinely be in flight. Absent findings are
  reported as *no finding records in this file*, not as a clean run: the viewer
  reads a file and never observed numbat evaluate anything.
- **Findings lead, and they name what they hit.** The rollup renders each
  rule's title, severity, and the file or command it fired on — not just a rule
  id — because the list it summarizes was already more informative than that.
  Counts are not terminal: every one that can name its records is a button that
  filters to them, so *5 findings* is a step rather than a full stop.
  Path counts are labelled *distinct files*, since they deduplicate by path
  while the cells beside them count events.
- **The one honest failure signal is used.** numbat tags a result `tool_error`
  only from a field the agent itself set to mark failure. The rollup counts
  those and says outright that the absence of the tag on the others is not
  evidence they succeeded.
- **Session boundaries are counted, not collapsed to a flag.** numbat maps
  `SubagentStart`/`SubagentStop` onto `session.start`/`session.end` and copies
  `session_id` from the agent rather than minting one, so every parallel
  dispatch adds a boundary pair to its *parent* session. One session in the
  author's corpus carries 29 `session.start` and 36 `session.end` records, of
  which exactly one start and *no* ends are its own — the rest belong to
  subagents. Treating "a `session.end` exists" as terminated would have called
  that session finished 36 times over when it never recorded an end at all.
  Only boundaries carrying no `sub_agent` decide the lifecycle, the state is
  named after the record (`session.end recorded`) rather than given a verdict
  word, and repeated root boundaries are reported as a possible resume rather
  than silently flattened.
- **Session list.** **⧉ Browse sessions** shows every session in the file with
  its agent, span, command count, findings, terminated state and opening
  prompt; clicking one isolates it. Rollups are computed on demand and cached
  per session, never for every session up front — one session in the reference
  corpus holds 76% of its records.
- **Rendering defects, found only in a real browser.** The session list
  inherited `white-space:nowrap` from `.btn`, letting a long prompt widen the
  pane and scroll the whole layout sideways; its prompt line was an inline
  `<span>`, on which `overflow`/`text-overflow` are ignored entirely, so it
  never ellipsised; and its findings chip was out-specified by a neighbouring
  rule, rendering the same grey as everything else — so in a security tool the
  one session with five high-severity findings looked identical to the rest.
  Live polling also reset the detail pane's scroll on every arrival, so reading
  a running session's caveats scrolled back to the top every few seconds. All
  fixed and re-verified at two viewport widths. A single-timestamp session
  reports *a single instant* rather than "over 0 ms".
- **Nothing in the pane is green.** Verdigris is this viewer's success colour,
  and a pane whose argument is that it cannot certify a session was clean had
  been using it for the "no findings" panel and for the word "ended". Both are
  now neutral.
- **`esc()` is not enough for a class attribute.** It escapes quotes and angle
  brackets but leaves spaces, so a record-derived `severity` of
  `"critical sv-low"` injected a second class token — and because the
  low-severity rule is declared later at equal specificity, a hostile finding
  could paint itself the muted colour an operator triages past. A new `cls()`
  sanitiser now guards every class attribute built from record content,
  including the record list's `sv-`/`k-` classes and `tag()`, which had the
  same shape. A malformed severity now renders with no severity colour at all
  rather than one of its choosing, and the odd value stays visible as a tell.
- **The session list no longer degrades with session count.** It rescanned
  every record once per session, so a file with many distinct `session_id`s
  was O(sessions × records) and rebuilt on every live poll — 20,000 sessions
  froze the main thread for ~2s each time, which is precisely the wrong
  failure mode for a forensic view under an agent that is still writing.
  Records are now bucketed by session in one pass; 8,010 sessions build in
  33ms and rebuild in 9ms. The list caps at 200 rows and the per-session rule
  list at 40, both saying what they dropped.
- **A crafted `session_id` can no longer produce a silently dead button.** The
  query language splits on whitespace and reads a leading `-` as negation, so
  an id containing either cannot round-trip through it — `"atkW1 -atkW1"`
  filtered to nothing while looking like a normal row. Such ids now report why
  they cannot be filtered instead of appearing to do nothing.
- **Two long-standing bugs in the neighbouring pure blocks**, found while
  checking the three for consistency: `dsTrunc()` could cut between a surrogate
  pair and emit a lone half — rendering as U+FFFD on any list row with an emoji
  — and `ipStr()` lacked the `isFinite` guard its two siblings have, so a
  non-finite number reached the operator as "Infinity". Both fixed, both tested.

## 0.4.1 — 2026-07-31

- **The viewer moved out of the directory numbat watches.** Deploying it into
  `~/.numbat/tools/` matched `tamper.detector_state_write` on every deploy —
  six of nine findings on the author's own machine were his own deploys. A rule
  that fires mostly on your routine stops being a signal. `numbatd` takes a
  `-tools` flag (default `<dir>/tools`, so existing installs are unaffected),
  `install.sh` installs the viewer and icon to `~/.termitarium`, and an install
  clears the assets an older layout left behind. Records stay in `~/.numbat`.
  Verified by execution: the deploy command that previously produced a finding
  now produces none.

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
