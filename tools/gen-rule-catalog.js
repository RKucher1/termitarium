#!/usr/bin/env node
//
// Generate the viewer's embedded rule catalog from numbat's rule YAML.
//
//   node tools/gen-rule-catalog.js --rules-dir ~/code/numbat-src/rules
//
// MAINTAINER TOOL. It is never needed at viewer runtime and is not shipped to
// users — the viewer stays a single self-contained HTML file with no build
// step. Run this only when numbat's rules change, then commit viewer.html.
//
// What it does: reads every rule YAML under --rules-dir, extracts the six
// fields the viewer needs, and rewrites the block between the
// [rulecat:begin] / [rulecat:end] markers in viewer/viewer.html.
//
// Rule text is Apache-2.0, © the numbat authors. It is embedded here under
// that licence and attributed in the generated header and in README.md.
//
// SECURITY. Rule text from disk becomes executable JavaScript inside a
// <script> element. Three defences, in order:
//
//   1. Values are emitted as JSON, so quotes, backslashes and control
//      characters are escaped by JSON.stringify. Backticks and ${ are inert
//      inside a double-quoted JSON string.
//   2. `< > &` and the U+2028/U+2029 line terminators are then escaped to
//      \uXXXX. This is what actually prevents `</script>` from closing the
//      element early — JSON.stringify alone does not touch it.
//   3. The emitted block is re-parsed and deep-compared against the source
//      objects. Any escaping bug fails the build instead of shipping.
//
// Rule files are read as text only. No rule content is require()d, eval()d or
// executed, symlinks are refused, and no path outside --rules-dir is read.
// There are no dependencies and no network access.
//
// One caveat, since this sits under a SECURITY header: provenance is read by
// running `git` inside --rules-dir (fixed argv, no shell, no rule text reaches
// the call). Git honours repository-supplied config, so point this at a repo
// you trust. It is a maintainer-only tool.

"use strict";

var fs   = require("fs");
var path = require("path");

var REQUIRED = ["id", "version", "title", "description", "severity"];
var BEGIN = "/* [rulecat:begin] */";
var END   = "/* [rulecat:end] */";

/* ── YAML: a deliberately narrow parser ──────────────────────────────────────
 *
 * numbat's rules use exactly three top-level shapes: plain scalars
 * (`severity: high`), optionally-quoted scalars (`version: "1.4"`), block
 * scalars (`description: |-`), and inline flow sequences (`tags: [a, b]`).
 * This handles those and nothing else, on purpose — a general YAML parser
 * would be a dependency, and this refuses to guess rather than parsing
 * something it does not understand. Callers must validate the result.
 */
function parseRuleYAML(text){
  var out = { tags: [], _problems: [] }, lines = String(text).split(/\r?\n/), i = 0;

  while(i < lines.length){
    var line = lines[i];

    // Only top-level keys. Indented lines belong to a block we already
    // consumed, or to a nested mapping we do not read.
    var m = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(line);
    if(!m){ i++; continue; }

    var key = m[1], rest = m[2].trim();

    // Block scalar: take every following line indented past column 0.
    if(rest === "|-" || rest === "|" || rest === ">-" || rest === ">"){
      var buf = [];
      i++;
      while(i < lines.length && (lines[i].trim() === "" || /^[ \t]/.test(lines[i]))){
        buf.push(lines[i].replace(/^[ \t]+/, ""));
        i++;
      }
      // Fold to a single line: these become one paragraph in the viewer.
      out[key] = buf.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }

    // Inline flow sequence.
    if(/^\[.*\]$/.test(rest)){
      // A quoted item may legally contain a comma; splitting on commas would
      // silently shred it into two tags.
      if(/["']/.test(rest))
        out._problems.push("quoted item in the inline list for '" + key + "' — not supported");
      out[key] = rest.slice(1, -1).split(",")
        .map(function(t){ return t.trim().replace(/^["']|["']$/g, ""); })
        .filter(function(t){ return t.length > 0; });
      i++;
      continue;
    }

    // An unterminated flow sequence wraps onto the next line. Refuse rather
    // than storing the fragment "[a," as if it were a scalar.
    if(rest.charAt(0) === "["){
      out._problems.push("multi-line inline list for '" + key + "' — not supported");
      i++;
      continue;
    }

    // Block sequence:  key:\n  - a\n  - b
    if(rest === ""){
      var seq = [], j = i + 1;
      while(j < lines.length && /^[ \t]*-[ \t]+/.test(lines[j])){
        seq.push(lines[j].replace(/^[ \t]*-[ \t]+/, "").trim().replace(/^["']|["']$/g, ""));
        j++;
      }
      if(seq.length){ out[key] = seq; i = j; continue; }
      // Otherwise a nested mapping follows (`sequence:`); record the key's
      // presence so kind can be derived, without reading into it.
      out[key] = "";
      i++;
      continue;
    }

    // Plain or quoted scalar.
    if(/^["']/.test(rest) && /\\["']/.test(rest))
      out._problems.push("escaped quote in the value of '" + key + "' — not supported");
    // An unquoted `#` starts a YAML comment; keeping it would ship the comment
    // into the viewer as part of the value.
    if(!/^["']/.test(rest) && /\s#/.test(rest))
      out._problems.push("inline comment in the value of '" + key + "' — not supported");

    out[key] = rest.replace(/^["']|["']$/g, "");
    i++;
  }

  return out;
}

/* ── escaping ───────────────────────────────────────────────────────────────
 *
 * Exported so tests can attack it directly with hostile input, without
 * needing a temp rules directory on disk.
 */
function jsonSafe(value){
  // None of these characters appear structurally in JSON, so a global replace
  // can only ever touch string contents.
  //
  //   < > &        prevent `</script>` and `<!--` closing the element early
  //   *            prevents rule text forming `/*` or `*/`, so it can never
  //                spell one of this file's own [rulecat:*] markers \u2014 a
  //                description that did would splice the block on the NEXT
  //                regeneration and corrupt viewer.html into a syntax error
  //   U+2028/9     legal in JSON, but line terminators in JavaScript source
  return JSON.stringify(value).replace(/[<>&*\u2028\u2029]/g, function(c){
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

/* ── directory walk, refusing to leave --rules-dir ──────────────────────── */

function ruleFiles(dir){
  var root = fs.realpathSync(dir), found = [];

  (function walk(cur){
    var entries = fs.readdirSync(cur, { withFileTypes: true });
    entries.sort(function(a, b){ return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });

    for(var i = 0; i < entries.length; i++){
      var e = entries[i], p = path.join(cur, e.name);

      // A symlink is refused outright rather than resolved — the cheapest
      // way to guarantee nothing outside the tree is ever read.
      if(e.isSymbolicLink()) continue;
      if(e.isDirectory()){ walk(p); continue; }
      if(!e.isFile()) continue;
      if(!/\.ya?ml$/.test(e.name)) continue;

      // Belt and braces: confirm the resolved path is still inside root.
      var real = fs.realpathSync(p);
      if(real !== root && real.indexOf(root + path.sep) !== 0) continue;

      found.push(real);
    }
  })(root);

  return found;
}

/* ── catalog assembly ───────────────────────────────────────────────────── */

// Rule ids that would poison an object literal. `rules["__proto__"] = x` on a
// normal object sets the prototype instead of adding a key, so the rule would
// vanish while every count still agreed; and emitting `{"__proto__": …}` into
// the viewer would set the prototype there too.
var UNSAFE_IDS = ["__proto__", "constructor", "prototype"];

function buildCatalog(dir){
  var files = ruleFiles(dir), rules = Object.create(null), problems = [], n = 0;

  for(var i = 0; i < files.length; i++){
    var file = files[i];
    var raw;
    try { raw = fs.readFileSync(file, "utf8"); }
    catch(e){ problems.push(file + ": unreadable — " + e.message); continue; }

    var r = parseRuleYAML(raw);

    var missing = REQUIRED.filter(function(k){
      return typeof r[k] !== "string" || r[k].trim() === "";
    });
    if(missing.length){
      problems.push(path.basename(file) + ": missing or unparsed " + missing.join(", "));
      continue;
    }
    // Shapes the narrow parser cannot read are reported, never guessed at.
    if(r._problems && r._problems.length){
      r._problems.forEach(function(p){ problems.push(path.basename(file) + ": " + p); });
      continue;
    }
    if(UNSAFE_IDS.indexOf(r.id) !== -1){
      problems.push(path.basename(file) + ": unsafe rule id " + r.id);
      continue;
    }
    if(Object.prototype.hasOwnProperty.call(rules, r.id)){
      problems.push(path.basename(file) + ": duplicate rule id " + r.id);
      continue;
    }

    rules[r.id] = {
      v:    r.version,
      sev:  r.severity,
      // `sequence:` present at top level means a correlated multi-event rule.
      kind: Object.prototype.hasOwnProperty.call(r, "sequence") ? "sequence" : "expr",
      t:    r.title,
      d:    r.description,
      g:    Array.isArray(r.tags) ? r.tags : []
    };
    n++;
  }

  // A key that silently failed to land would otherwise be invisible: n counts
  // assignments, Object.keys counts what actually exists.
  if(Object.keys(rules).length !== n)
    problems.push("internal: " + n + " rules parsed but " + Object.keys(rules).length + " landed in the catalog");

  return { rules: rules, count: n, files: files.length, problems: problems };
}

function gitSha(dir){
  try {
    var cp = require("child_process");
    // Reads repository metadata for provenance. Nothing from the rule files
    // themselves is passed to, or executed by, this call.
    var out = cp.execFileSync("git", ["-C", dir, "rev-parse", "HEAD"],
                              { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch(e){ return null; }
}

// Provenance must identify the SOURCE, never this machine. An absolute local
// path would leak the maintainer's username and directory layout into a file
// that ships publicly, and would make the generated block differ between two
// maintainers regenerating from identical input.
function gitOrigin(dir){
  try {
    var cp = require("child_process");
    var out = cp.execFileSync("git", ["-C", dir, "remote", "get-url", "origin"],
                              { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "") || null;
  } catch(e){ return null; }
}

function gitDescribe(dir){
  try {
    var cp = require("child_process");
    var out = cp.execFileSync("git", ["-C", dir, "describe", "--tags", "--always"],
                              { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch(e){ return null; }
}

function renderBlock(meta, rules){
  var ids = Object.keys(rules).sort();
  var lines = [];

  lines.push(BEGIN);
  lines.push("  /* GENERATED by tools/gen-rule-catalog.js — do not edit by hand.");
  lines.push("     Regenerate when numbat's rules change, then commit viewer.html.");
  lines.push("");
  lines.push("     Rule titles and descriptions are © the numbat authors and are");
  lines.push("     embedded here under the Apache License 2.0.");
  lines.push("");
  lines.push("     source:  " + meta.source);
  lines.push("     commit:  " + meta.sha);
  lines.push("     release: " + meta.release);
  lines.push("     rules:   " + ids.length + " */");
  lines.push("  var RULECAT_META = " + jsonSafe(meta) + ";");
  lines.push("  var RULECAT = {");
  for(var i = 0; i < ids.length; i++){
    lines.push("    " + jsonSafe(ids[i]) + ": " + jsonSafe(rules[ids[i]]) +
               (i === ids.length - 1 ? "" : ","));
  }
  lines.push("  };");
  lines.push("  " + END);

  return lines.join("\n");
}

/* Re-parse what we are about to write and compare it against the source
 * objects. Catches any escaping defect before it reaches viewer.html. */
function verifyRoundTrip(block, meta, rules){
  var body = block.slice(block.indexOf("var RULECAT = {") + "var RULECAT = ".length,
                         block.lastIndexOf("};") + 1);
  var back;
  try { back = JSON.parse(body); }
  catch(e){ return "emitted catalog is not valid JSON — " + e.message; }

  // Compare per key, not whole-object: renderBlock emits ids sorted while
  // buildCatalog inserts them in file-walk order, so a whole-object stringify
  // would report a mere ordering difference as an escaping defect.
  var wantIds = Object.keys(rules).sort(), gotIds = Object.keys(back).sort();
  if(wantIds.length !== gotIds.length)
    return "emitted catalog has " + gotIds.length + " rules, expected " + wantIds.length;
  for(var i = 0; i < wantIds.length; i++){
    if(wantIds[i] !== gotIds[i])
      return "emitted catalog rule ids differ at " + wantIds[i];
    if(JSON.stringify(back[wantIds[i]]) !== JSON.stringify(rules[wantIds[i]]))
      return "emitted catalog does not round-trip rule " + wantIds[i];
  }

  if(block.indexOf("</script") !== -1 || block.indexOf("<!--") !== -1)
    return "emitted catalog contains a raw script-breakout sequence";
  if(/[\u2028\u2029]/.test(block))
    return "emitted catalog contains a raw U+2028/U+2029 line terminator";

  // The block must contain exactly one of each marker. Rule text that spelled
  // a marker would survive run 1 inertly, then splice the block on run 2 and
  // leave stray tokens in the viewer's only <script>.
  if(block.indexOf(BEGIN) !== block.lastIndexOf(BEGIN))
    return "emitted catalog contains more than one " + BEGIN + " marker";
  if(block.indexOf(END) !== block.lastIndexOf(END))
    return "emitted catalog contains more than one " + END + " marker";

  var metaBody = block.slice(block.indexOf("var RULECAT_META = ") + "var RULECAT_META = ".length);
  metaBody = metaBody.slice(0, metaBody.indexOf(";\n"));
  try {
    if(JSON.stringify(JSON.parse(metaBody)) !== JSON.stringify(meta))
      return "emitted metadata does not round-trip";
  } catch(e){ return "emitted metadata is not valid JSON — " + e.message; }

  return null;
}

/* ── CLI ────────────────────────────────────────────────────────────────── */

function die(msg){
  process.stderr.write("gen-rule-catalog: " + msg + "\n");
  process.exit(2);
}

function main(argv){
  var rulesDir = null, sha = null, viewer = null;

  for(var i = 0; i < argv.length; i++){
    if(argv[i] === "--rules-dir")  rulesDir = argv[++i];
    else if(argv[i] === "--source-sha") sha = argv[++i];
    else if(argv[i] === "--viewer") viewer = argv[++i];
    else die("unknown argument " + argv[i]);
  }

  if(!rulesDir) die("--rules-dir is required");
  if(!viewer) viewer = path.join(__dirname, "..", "viewer", "viewer.html");

  var stat;
  try { stat = fs.statSync(rulesDir); }
  catch(e){ die("cannot read --rules-dir " + rulesDir + " — " + e.message); }
  if(!stat.isDirectory()) die("--rules-dir is not a directory: " + rulesDir);

  var built = buildCatalog(rulesDir);

  // Fail loudly rather than silently shipping a thin catalog.
  if(built.problems.length){
    process.stderr.write("gen-rule-catalog: refusing to write — " +
                         built.problems.length + " rule file(s) did not parse cleanly:\n");
    built.problems.forEach(function(p){ process.stderr.write("  - " + p + "\n"); });
    process.exit(2);
  }
  if(built.count === 0) die("no rules found under " + rulesDir);
  if(built.count !== built.files)
    die("parsed " + built.count + " rules from " + built.files + " files — counts must match");

  if(!sha) sha = gitSha(rulesDir);
  if(!sha) die("could not determine the numbat commit SHA; pass --source-sha");

  var meta = {
    source:  gitOrigin(rulesDir) || "unknown",
    sha:     sha,
    release: gitDescribe(rulesDir) || "unknown",
    rules:   built.count
  };

  var block = renderBlock(meta, built.rules);

  var problem = verifyRoundTrip(block, meta, built.rules);
  if(problem) die("self-check failed: " + problem);

  var html;
  try { html = fs.readFileSync(viewer, "utf8"); }
  catch(e){ die("cannot read viewer " + viewer + " — " + e.message); }

  var a = html.indexOf(BEGIN), b = html.indexOf(END);
  if(a === -1 || b === -1 || b < a)
    die("could not find the [rulecat:begin]/[rulecat:end] markers in " + viewer);

  var updated = html.slice(0, a) + block + html.slice(b + END.length);
  fs.writeFileSync(viewer, updated, "utf8");

  process.stdout.write("wrote " + built.count + " rules to " + viewer + "\n" +
                       "  commit  " + sha + "\n" +
                       "  release " + meta.release + "\n");
}

module.exports = {
  parseRuleYAML: parseRuleYAML,
  jsonSafe: jsonSafe,
  buildCatalog: buildCatalog,
  renderBlock: renderBlock,
  verifyRoundTrip: verifyRoundTrip,
  ruleFiles: ruleFiles,
  REQUIRED: REQUIRED,
  UNSAFE_IDS: UNSAFE_IDS,
  BEGIN: BEGIN,
  END: END
};

if(require.main === module) main(process.argv.slice(2));
