#!/usr/bin/env bash
# Tests for install.sh — the paths where "it looked configured" and "it actually
# happened" have drifted apart before.
#
#   bash test/install-logic.sh
#
# Everything runs against a sandbox HOME and NUMBAT_DIR under a temp directory,
# so the real ~/.numbat, the real ~/Library/LaunchAgents and the real fish
# config are never touched. Agent loading is skipped with --no-agents: these
# tests must never call launchctl load against the developer's own session.
#
# No dependencies beyond what install.sh already requires (bash, go, python3).

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$ROOT/install.sh"

pass=0; fails=()

ok(){   if [ "$2" = "0" ]; then pass=$((pass+1)); else fails+=("$1"); fi; }
okz(){  # ok if string $2 is non-empty
  if [ -n "$2" ]; then pass=$((pass+1)); else fails+=("$1"); fi; }
oke(){  # ok if string $2 is empty
  if [ -z "$2" ]; then pass=$((pass+1)); else fails+=("$1${3:+ — $3}"); fi; }

SANDBOX="$(mktemp -d)"
cleanup(){ rm -rf "$SANDBOX"; }
trap cleanup EXIT

# launchctl is NOT scoped by $HOME: a sandboxed HOME does not sandbox launchd.
# Without fake labels, an --uninstall run here would bootout the developer's own
# agents. These names cannot match anything real. (Learned the hard way — an
# earlier version of this file took the live daemon down mid-suite.)
FAKE_D="com.termitarium-test.$$.numbatd"
FAKE_P="com.termitarium-test.$$.prune"
FAKE_LEGACY="com.termitarium-test.$$.legacy-numbatd com.termitarium-test.$$.legacy-prune"

run_install(){  # run_install <extra args...>
  env HOME="$SANDBOX/home" NUMBAT_DIR="$SANDBOX/numbat" NUMBAT_PORT=8791 \
      TERMITARIUM_TOOLS="$SANDBOX/tools" \
      NUMBAT_LABEL_D="$FAKE_D" NUMBAT_LABEL_P="$FAKE_P" \
      NUMBAT_LEGACY_LABELS="$FAKE_LEGACY" \
      bash "$INSTALL" "$@" 2>&1
}

mkdir -p "$SANDBOX/home" "$SANDBOX/numbat"

# ── shape checks that need no execution ────────────────────────────────────

syntax="$(bash -n "$INSTALL" 2>&1)"
oke "install.sh parses" "$syntax" "$syntax"

# The legacy labels must appear in BOTH the migration path and uninstall.
# Uninstalling only the current pair is how a renamed agent survives.
grep -q 'LEGACY_LABELS=' "$INSTALL"; ok "install.sh defines LEGACY_LABELS" $?
grep -q 'com.numbat-tools.numbatd' "$INSTALL"; ok "legacy daemon label is listed" $?
grep -q 'migrate_legacy' "$INSTALL"; ok "a migration step exists" $?

# migrate_legacy must run before the new agents are brought up, or the old
# daemon still holds the port when the new one starts. Anchor on the CALL site
# of agent_reload, not on "launchctl load" — that string also appears inside
# agent_reload's own fallback, which is defined above migrate_legacy.
mig_line=$(grep -n '^  migrate_legacy$' "$INSTALL" | tail -1 | cut -d: -f1)
reload_line=$(grep -n 'agent_reload "\$l"' "$INSTALL" | head -1 | cut -d: -f1)
if [ -n "$mig_line" ] && [ -n "$reload_line" ] && [ "$mig_line" -lt "$reload_line" ]; then
  pass=$((pass+1)); else fails+=("migration runs before the agents are brought up"); fi

# Uninstall must cover legacy labels too.
unin=$(sed -n '/UNINSTALL:-0/,/^fi$/p' "$INSTALL")
case "$unin" in
  *LEGACY_LABELS*) pass=$((pass+1)) ;;
  *) fails+=("uninstall removes legacy labels as well as current ones") ;;
esac

# ── is_loaded must not be a pipe ───────────────────────────────────────────
#
# `launchctl list | grep -q X` under `set -o pipefail` returns 141, not 0, when
# X matches: grep exits at the first hit, launchctl dies of SIGPIPE, pipefail
# surfaces it. The check then reports a loaded agent as missing, and only ever
# when the answer is yes.

isl="$(sed -n '/^is_loaded()/p' "$INSTALL")"
okz "is_loaded is defined" "$isl"
case "$isl" in
  *"launchctl list"*"|"*grep*) fails+=("is_loaded pipes launchctl into grep — SIGPIPE + pipefail gives a false negative") ;;
  *) pass=$((pass+1)) ;;
esac

# Prove the mechanism rather than trusting the shape of the line.
pipe_rc=0; herestring_rc=0
( set -euo pipefail; printf 'a\nTARGET\nb\n' | grep -q 'TARGET' ) >/dev/null 2>&1 || pipe_rc=$?
( set -euo pipefail; grep -q 'TARGET' <<<"$(printf 'a\nTARGET\nb\n')" ) >/dev/null 2>&1 || herestring_rc=$?
[ "$herestring_rc" -eq 0 ]; ok "a here-string match returns 0 under pipefail" $?

# install.sh must actually use the safe form against a real launchctl list.
probe_rc=0
( set -euo pipefail
  is_loaded(){ grep -q "[[:space:]]$1\$" <<<"$(launchctl list 2>/dev/null || true)"; }
  is_loaded "definitely-not-a-real-label-xyz" ) >/dev/null 2>&1 || probe_rc=$?
[ "$probe_rc" -ne 0 ]; ok "is_loaded returns non-zero for an absent label" $?

# ── go build actually works (this was broken: no go.mod anywhere) ──────────

[ -f "$ROOT/numbatd/go.mod" ]; ok "numbatd has a go.mod so it builds outside GOPATH" $?
if command -v go >/dev/null 2>&1; then
  build="$(cd "$ROOT/numbatd" && CGO_ENABLED=0 go build -o "$SANDBOX/numbatd" . 2>&1)"
  oke "numbatd builds from a clean checkout" "$build" "$build"
  [ -x "$SANDBOX/numbatd" ]; ok "the built binary is executable" $?
else
  echo "  (skipping build check — no go toolchain)"
fi

# ── the icon the daemon serves must exist and be a real PNG ────────────────

[ -f "$ROOT/viewer/favicon.png" ]; ok "viewer/favicon.png exists" $?
png_ok="$(python3 - "$ROOT/viewer/favicon.png" <<'PY'
import struct, sys
d = open(sys.argv[1], "rb").read()
if d[:8] != b"\x89PNG\r\n\x1a\n":
    print("bad signature"); raise SystemExit
w, h, depth, ctype = struct.unpack(">IIBB", d[16:26])
if (w, h) != (32, 32): print(f"wrong size {w}x{h}")
PY
)"
oke "favicon.png is a valid 32x32 PNG" "$png_ok" "$png_ok"

# install.sh must actually install it, or the route 404s
grep -q 'favicon.png' "$INSTALL"; ok "install.sh installs the icon" $?
grep -q '\-tools' "$INSTALL"; ok "the plist passes -tools to numbatd" $?
grep -q 'toolsDir' "$ROOT/numbatd/main.go"; ok "numbatd honours a -tools directory" $?

# ── install, twice, into a sandbox ─────────────────────────────────────────

if command -v go >/dev/null 2>&1; then
  out1="$(run_install --no-agents)"
  ok "first --no-agents install succeeds" $?
  [ -f "$SANDBOX/tools/viewer.html" ]; ok "viewer.html installed" $?
  [ -f "$SANDBOX/tools/favicon.png" ]; ok "favicon.png installed" $?
  # The whole point of the move: nothing served may live under the directory
  # numbat watches, or every deploy trips tamper.detector_state_write.
  [ ! -e "$SANDBOX/numbat/tools/viewer.html" ]
  ok "no viewer is written into the watched record directory" $?
  [ ! -e "$SANDBOX/numbat/tools/favicon.png" ]
  ok "no icon is written into the watched record directory" $?
  [ -x "$SANDBOX/numbat/bin/numbatd" ];       ok "numbatd installed" $?
  [ -x "$SANDBOX/numbat/bin/numbat-prune" ];  ok "numbat-prune installed" $?

  # It must not claim to have installed a fish function when there is no fish.
  case "$out1" in
    *"skipping the nb fish function"*) pass=$((pass+1)) ;;
    *"installing fish function"*) fails+=("claims to install a fish function with no ~/.config/fish") ;;
    *) pass=$((pass+1)) ;;
  esac

  # Idempotency: a second run must succeed and leave the same files.
  sum1="$(cd "$SANDBOX" && find numbat tools -type f 2>/dev/null | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)"
  out2="$(run_install --no-agents)"
  ok "second --no-agents install succeeds (idempotent)" $?
  sum2="$(cd "$SANDBOX" && find numbat tools -type f 2>/dev/null | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)"
  [ "$sum1" = "$sum2" ]; ok "a repeat install leaves identical files" $?

  # With a fish config present it must install the function and say so.
  mkdir -p "$SANDBOX/home/.config/fish"
  out3="$(run_install --no-agents)"
  [ -s "$SANDBOX/home/.config/fish/functions/nb.fish" ]; ok "fish function written when fish is present" $?
  grep -q 'com.siliconhills.numbatd' "$SANDBOX/home/.config/fish/functions/nb.fish"
  ok "installed fish function targets the current label" $?
  grep -q '__PORT__\|__DIR__' "$SANDBOX/home/.config/fish/functions/nb.fish"
  if [ $? -eq 0 ]; then fails+=("fish function still contains unsubstituted placeholders"); else pass=$((pass+1)); fi
fi

# ── uninstall removes what it installed, including legacy plists ───────────

AG="$SANDBOX/home/Library/LaunchAgents"
mkdir -p "$AG"
# Plant plists under the FAKE labels. Nothing by these names is ever loaded, so
# no bootout reaches the real launchd session.
printf '<plist/>' > "$AG/${FAKE_LEGACY%% *}.plist"
printf '<plist/>' > "$AG/$FAKE_D.plist"

out_un="$(run_install --uninstall)"; un_rc=$?
[ "$un_rc" -eq 0 ]; ok "uninstall exits cleanly when nothing is left loaded" $?
[ ! -f "$AG/${FAKE_LEGACY%% *}.plist" ]; ok "uninstall removes the LEGACY plist" $?
[ ! -f "$AG/$FAKE_D.plist" ];            ok "uninstall removes the current plist" $?

# The real agents must be untouched by the suite.
if launchctl list 2>/dev/null | grep -q "[[:space:]]com.siliconhills.numbatd$"; then
  pass=$((pass+1))
else
  fails+=("THE SUITE DISTURBED THE REAL com.siliconhills.numbatd AGENT — rerun ./install.sh")
fi
[ ! -f "$SANDBOX/tools/viewer.html" ];  ok "uninstall removes viewer.html" $?
[ ! -f "$SANDBOX/tools/favicon.png" ];  ok "uninstall removes favicon.png" $?
[ ! -f "$SANDBOX/home/.config/fish/functions/nb.fish" ]; ok "uninstall removes the fish function" $?

# ── nb.fish must not swallow launchctl failures ────────────────────────────

NB="$ROOT/shell/nb.fish"
grep -q 'com.siliconhills.numbatd.plist' "$NB"; ok "nb.fish targets the current label" $?
grep -q 'launchctl load .*2>/dev/null' "$NB"
if [ $? -eq 0 ]; then fails+=("nb.fish still suppresses launchctl load errors"); else pass=$((pass+1)); fi
grep -q 'not found' "$NB"; ok "nb.fish reports a missing plist" $?

# ── report ─────────────────────────────────────────────────────────────────

if [ ${#fails[@]} -gt 0 ]; then
  printf '\n%d failure(s):\n\n' "${#fails[@]}" >&2
  for f in "${fails[@]}"; do printf '  - %s\n' "$f" >&2; done
  printf '\n%d passed, %d failed\n' "$pass" "${#fails[@]}" >&2
  exit 1
fi
printf '%d checks passed\n' "$pass"
