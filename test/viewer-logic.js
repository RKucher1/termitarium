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

function loadDescribe(){
  var html;
  try { html = fs.readFileSync(VIEWER, "utf8"); }
  catch(e){ bail("cannot read " + VIEWER + " — " + e.message); }

  var BEGIN = "/* [describe:begin] */", END = "/* [describe:end] */";
  var a = html.indexOf(BEGIN), b = html.indexOf(END);
  if(a === -1 || b === -1 || b < a)
    bail("could not find the [describe:begin]/[describe:end] markers in viewer/viewer.html");

  var src = html.slice(a + BEGIN.length, b);
  if(!/function\s+describe\s*\(/.test(src))
    bail("the marked block does not define describe()");

  // Sloppy-mode globals would leak here; "use strict" makes that a ReferenceError.
  try {
    return new Function('"use strict";' + src + "\nreturn describe;")();
  } catch(e){
    bail("the marked block failed to evaluate standalone — " + e.message);
  }
}

function bail(msg){
  process.stderr.write("FATAL: " + msg + "\n");
  process.exit(2);
}

var describe = loadDescribe();

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

/* ── report ─────────────────────────────────────────────────────────────── */

if(failures.length){
  process.stderr.write("\n" + failures.length + " failure" + (failures.length===1?"":"s") + ":\n\n");
  failures.forEach(function(f, i){ process.stderr.write("  " + (i+1) + ") " + f + "\n\n"); });
  process.stderr.write(pass + " passed, " + failures.length + " failed\n");
  process.exit(1);
}
process.stdout.write(pass + " assertions passed\n");
