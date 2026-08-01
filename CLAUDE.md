# Working on Termitarium

Conventions this repository actually enforces. Every one of these was already
true of the code before it was written down; sessions had been inferring them,
and inference failed at least once (see *Commit messages*).

---

## Workflow

Sessions **commit and push directly** once the work is verified — no PR, no
review gate. Then **deploy to `~/.termitarium`** and **verify by execution**:

```sh
install -m 644 viewer/viewer.html ~/.termitarium/viewer.html
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
curl -s http://127.0.0.1:8787/ | cmp - viewer/viewer.html && echo "served == repo"
```

The daemon serves the viewer from its `-tools` directory, which is
`~/.termitarium`. Editing `viewer/viewer.html` changes nothing that is running
until you copy it there. "It should work now" is not a deploy.

### Commit messages

**Never mention Claude, Anthropic, or AI authorship.** No `Co-Authored-By:`, no
"Generated with", no "🤖". Not in commit messages, not in PR bodies, not in code
comments, not in `CHANGELOG.md`.

This is not a style preference. `cd39c20` carries
`Co-Authored-By: Claude <noreply@anthropic.com>`; it is on `main` and pushed, so
it stays. Its side effect is instructive: numbat extracted that trailer as an
`email` indicator, so the tool's own corpus now contains a record whose only
cause was a session ignoring this rule. Do not add a second one. Do not rewrite
published history to remove the first.

Write what changed and why, in the voice of someone who owns the code.

---

## The viewer is one self-contained file

`viewer/viewer.html` is a single HTML file: one IIFE, **no build step, no
framework, no dependency, no module system**. It is opened directly or served as
one file. There is nothing to compile and nothing to install.

- **Virtual scrolling, `ROW = 29` fixed.** The list renders a window of rows and
  a spacer sized `view.length * ROW`. `ROW` is a constant that the CSS row height
  must match exactly; if they diverge, scrolling drifts. Measure it in the live
  DOM when you touch either.
- Large files are parsed in chunks with a size guard. Keep both.

## `esc()` and `cls()` are the sole escape points

**Record content is untrusted input.** These records describe what an AI agent
did, and anything that can influence agent behaviour can influence record text —
commands, paths, tool names, ids, titles, rule names.

- `esc()` escapes `& < > " '` and is correct for text and for **quoted**
  attribute values.
- `cls()` is required for anything reaching a `class` attribute. `esc()` leaves
  spaces alone, so a record-derived value could otherwise inject a second class
  token and choose the colour an operator triages by.
- **Pure logic returns data, never markup.** `describe()`, `interpret()`,
  `explain()` and `rollup()` return strings and objects; the render functions
  escape them. If a pure function ever returns HTML, escaping has two homes and
  one of them will be wrong.
- Never interpolate a record value into an unquoted attribute, an `id`, a URL,
  or a `<style>`/`<script>` context.

Maps keyed on record-derived strings must be bounded and null-prototype
(`Object.create(null)`), and read through `hasOwnProperty`. A record whose id is
`__proto__` or `constructor` is legal JSON. Loops driven off record content
(array lengths, id lists) must be capped, and the cap stated to the operator
rather than applied silently.

## Network surface

Exactly three routes, and nothing else, ever:

```
GET       /api/sources
GET|HEAD  /files/*
GET       /favicon.ico
```

Plus `GET /` for the viewer itself. The viewer makes **no other request** — no
CDN, no font, no telemetry, no analytics, no model call. Everything it displays
is computed locally and deterministically from the file it loaded. A feature
that needs a network call does not belong here.

`numbatd` binds loopback only, requires a loopback `Host` header, sends no CORS
headers, whitelists filenames, and refuses to start otherwise. Do not relax any
of it for convenience.

## Claim only what the record supports

This is a forensic tool. Its whole value is that it never tells an operator
something the record does not establish.

- **No inferred verdict stated as fact.** No record in the reference corpus
  carries an `exit_code`, so success cannot be shown — a result reports its
  duration and the pane says whether it succeeded is not recorded.
- A missing counterpart means **no result was recorded**. It does not mean the
  action failed, and it does not mean it ran.
- Distinguish *absent from the file* from *not indexed by this viewer*. Saying
  a record "does not appear in this file" about one the viewer merely declined
  to index is a fabricated absence.
- Every caveat must be **gated on a field that is actually present**. Where a
  field is missing, omit the line rather than guessing.
- Reuse the existing condition vocabulary. An operator moving between an event,
  a finding and a session summary should not feel they changed product.
- Do not spend per-record space explaining a field that never varies. A constant
  bullet on every pane trains the eye to skip the section, including on the rare
  records where it carries something real.

## Pure blocks stay independently extractable

Marked blocks look like this and are lifted **verbatim** by
`test/viewer-logic.js` and evaluated standalone:

```
/* [describe:begin] */ … /* [describe:end] */
/* [interpret:begin] */ … /* [interpret:end] */
/* [explain:begin] */ … /* [explain:end] */
/* [rollup:begin] */ … /* [rollup:end] */
/* [rulecat:begin] */ … /* [rulecat:end] */
/* [sizeguard:begin] */ … /* [sizeguard:end] */
```

**No helper may cross a marker boundary.** A block that reaches for the DOM, a
global, or a function defined elsewhere in the file fails its extraction test
loudly rather than silently testing a stub. This is why `dsStr`/`ipStr`/`ruStr`/
`exStr` are near-duplicates: the duplication is the price of the guarantee, and
it is the correct trade. When two blocks must agree on a *format*, duplicate the
implementation and add a test asserting the outputs match.

Blocks are pure: no DOM, no globals, never throw, never return empty. Sibling
data arrives as an argument (`interpret(record, catalog)`,
`explain(record, index)`, `rollup(records, sessionId)`) — never from a global.

## No scope gate

**Fix bugs where you find them**, in whatever file they live in. If something
outside your task is broken or blocking, fix it. Prefer a working system over a
clean diff.

The only requirement: **name every file you touched, and why, in the summary**,
so nothing lands silently.

## Verify by execution, not configuration

A green suite proves nothing on its own.

- **Mutation-test the assertions that matter.** Break the behaviour on purpose
  and confirm the test fails. An assertion that passes both ways is decoration.
  This has repeatedly caught tests that asserted the honest sentence was present
  without checking a contradicting one was absent.
- **Browser-verify rendering changes** in real Chrome. Every session that
  skipped this found a defect that passed headless checks.
- Run against the **real corpus** (`~/.numbat/records.ndjson`), and cross-check
  counts against independent `jq`. Snapshot it first — it is live, and the
  session you are running is being written into it.
- Tests must be **clean-clone runnable** with fixtures inline: no corpus, no
  network, no `HOME`.

```sh
node test/viewer-logic.js
bash test/install-logic.sh
node --check <(sed -n '/<script>/,/<\/script>/p' viewer/viewer.html | sed '1d;$d')
```

## Ground design in the corpus, not the schema doc

Multiple sessions have found the documentation wrong about the data. Run the
counts before designing anything. Things the docs got wrong, each found by
reading records:

- `tool_call_id` joins **four** pair shapes, not two. `tool.result` mostly
  answers `file.read`/`file.write`, not `tool.call`.
- `network.indicator` is not an event type. Indicators are a separate
  `record_type`.
- No record carries an `exit_code`. Anywhere.
- `confidence` and `source_type` are single constants across every event.
- `message.assistant` never carries `content_preview`.
- Indicators are **lexical extractions** from record text: every `sha1` in the
  corpus is a git commit hash, and the `email` values are an SSH remote and a
  commit trailer.

Write down what you verified and what contradicted the docs, so the next session
does not re-derive it.
