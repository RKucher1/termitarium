#!/usr/bin/env bash
# install.sh — install the numbat viewer toolkit for the current user.
#
#   ./install.sh              build + install + load launch agents
#   ./install.sh --no-agents  install files only, skip launchd
#   ./install.sh --uninstall  remove agents and installed files (keeps data)
#
# Everything is per-user. Nothing is written outside $HOME. No sudo.

set -euo pipefail

NUMBAT_DIR="${NUMBAT_DIR:-$HOME/.numbat}"
AGENTS="$HOME/Library/LaunchAgents"
PORT="${NUMBAT_PORT:-8787}"
# Overridable so the test suite can operate on labels that cannot collide with
# a real install. launchctl is not scoped by $HOME — a sandboxed HOME does not
# sandbox launchd — so without this a test running --uninstall would bootout
# the developer's own running agents.
LABEL_D="${NUMBAT_LABEL_D:-com.siliconhills.numbatd}"
LABEL_P="${NUMBAT_LABEL_P:-com.siliconhills.numbat-prune}"
# Labels this toolkit used before it was renamed. An install from that era left
# agents behind that these labels no longer match, so installing again would
# have stacked a second daemon on the same port instead of replacing the first.
# Both install and uninstall have to know about them.
LEGACY_LABELS="${NUMBAT_LEGACY_LABELS:-com.numbat-tools.numbatd com.numbat-tools.prune}"
DO_AGENTS=1

say(){ printf '\033[1m›\033[0m %s\n' "$1"; }
warn(){ printf '\033[1m!\033[0m %s\n' "$1" >&2; }
die(){ printf 'install.sh: %s\n' "$1" >&2; exit 1; }

# Is a launchd label currently loaded? Kept separate from "does a plist exist"
# because the two disagree exactly when something has gone wrong.
#
# Deliberately a here-string, not a pipe. As `launchctl list | grep -q` under
# `set -o pipefail`, grep exits at the first match and closes the pipe, launchctl
# dies of SIGPIPE, and pipefail returns that 141 as the result — so a loaded
# agent reports as missing. The bug only appears when the answer is yes.
is_loaded(){ grep -q "[[:space:]]$1\$" <<<"$(launchctl list 2>/dev/null || true)"; }

# Reload an agent so a rewritten plist actually takes effect.
#
# `launchctl load` prints "Load failed: 5: Input/output error" and STILL EXITS
# 0 when the label is already loaded, so the legacy pair reports success while
# leaving the old definition in place — the plist on disk changes and nothing
# else does. bootout/bootstrap return honest exit codes, so they are tried
# first; load/unload remain as a fallback for macOS versions without them.
# Neither is trusted: the caller re-checks with is_loaded.
agent_reload(){
  label="$1"; plist="$AGENTS/$label.plist"; uid="$(id -u)"
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  if launchctl bootstrap "gui/$uid" "$plist" 2>/dev/null; then
    return 0
  fi
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist" 2>/dev/null || true
}

# Remove agents left by the pre-rename install. Runs before the new agents are
# written, so the old daemon has released the port by the time the new one
# loads. Reports what it did — a silent migration is how the original problem
# stayed invisible for three sessions.
migrate_legacy(){
  found=0
  for l in $LEGACY_LABELS; do
    if is_loaded "$l"; then
      say "legacy agent $l is loaded — unloading it"
      launchctl bootout "gui/$(id -u)/$l" 2>/dev/null \
        || launchctl unload "$AGENTS/$l.plist" 2>/dev/null || true
      if is_loaded "$l"; then
        warn "could not unload $l; run: launchctl bootout gui/$(id -u)/$l"
      fi
      found=1
    fi
    if [ -f "$AGENTS/$l.plist" ]; then
      say "removing legacy plist $l.plist"
      rm -f "$AGENTS/$l.plist"
      found=1
    fi
  done
  if [ "$found" = "1" ]; then
    say "migrated from com.numbat-tools.* to com.siliconhills.*"
  fi
}

# Anything already holding the port that is not one of our agents would make
# the health check below pass while serving somebody else's content.
check_port(){
  command -v lsof >/dev/null 2>&1 || return 0
  holders="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -n "$holders" ] || return 0
  for pid in $holders; do
    exe="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
    case "$exe" in
      *numbatd) : ;;
      "") : ;;
      *) warn "port $PORT is held by PID $pid ($exe), which is not numbatd" ;;
    esac
  done
}

for a in "$@"; do
  case "$a" in
    --no-agents) DO_AGENTS=0 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $a" ;;
  esac
done

if [ "${UNINSTALL:-0}" = "1" ]; then
  # Legacy labels are removed too. Uninstalling only the current pair is how a
  # renamed agent survives an uninstall and keeps serving the port.
  for l in $LABEL_D $LABEL_P $LEGACY_LABELS; do
    if is_loaded "$l"; then
      launchctl bootout "gui/$(id -u)/$l" 2>/dev/null \
        || launchctl unload "$AGENTS/$l.plist" 2>/dev/null || true
    fi
    if [ -f "$AGENTS/$l.plist" ]; then
      rm -f "$AGENTS/$l.plist"
      say "removed agent $l"
    elif is_loaded "$l"; then
      warn "$l is loaded but its plist is gone; run: launchctl bootout gui/$(id -u)/$l"
    fi
  done
  rm -f "$NUMBAT_DIR/bin/numbatd" "$NUMBAT_DIR/bin/numbat-prune" \
        "$NUMBAT_DIR/tools/viewer.html" "$NUMBAT_DIR/tools/favicon.png"
  rm -f "$HOME/.config/fish/functions/nb.fish"

  # Say what is actually true rather than assuming the removals worked.
  left=0
  for l in $LABEL_D $LABEL_P $LEGACY_LABELS; do
    if is_loaded "$l"; then warn "still loaded: $l"; left=1; fi
  done
  if [ "$left" = "1" ]; then
    die "uninstall incomplete — see the warnings above"
  fi
  say "removed. Your records in $NUMBAT_DIR were left untouched."
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || say "warning: launchd steps are macOS-only; files will still install"
command -v go >/dev/null 2>&1 || die "go toolchain not found (brew install go)"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

mkdir -p "$NUMBAT_DIR/tools" "$NUMBAT_DIR/bin" "$AGENTS"

say "building numbatd"
( cd "$(dirname "$0")/numbatd" && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$NUMBAT_DIR/bin/numbatd" . )

say "installing viewer, icon and prune"
install -m 644 "$(dirname "$0")/viewer/viewer.html" "$NUMBAT_DIR/tools/viewer.html"
install -m 644 "$(dirname "$0")/viewer/favicon.png" "$NUMBAT_DIR/tools/favicon.png"
install -m 755 "$(dirname "$0")/prune/numbat-prune" "$NUMBAT_DIR/bin/numbat-prune"

if [ "$DO_AGENTS" = "1" ] && [ "$(uname -s)" = "Darwin" ]; then
  migrate_legacy
  check_port
  say "writing launch agents"
  cat > "$AGENTS/$LABEL_D.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL_D</string>
  <key>ProgramArguments</key><array>
    <string>$NUMBAT_DIR/bin/numbatd</string>
    <string>-addr</string><string>127.0.0.1:$PORT</string>
    <string>-dir</string><string>$NUMBAT_DIR</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$NUMBAT_DIR/numbatd.log</string>
  <key>StandardErrorPath</key><string>$NUMBAT_DIR/numbatd.log</string>
</dict></plist>
PLIST

  cat > "$AGENTS/$LABEL_P.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL_P</string>
  <key>ProgramArguments</key><array>
    <string>$NUMBAT_DIR/bin/numbat-prune</string>
    <string>-d</string><string>30</string>
    <string>--archive-days</string><string>90</string>
  </array>
  <key>StartCalendarInterval</key><dict>
    <key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer>
  </dict>
  <key>StandardOutPath</key><string>$NUMBAT_DIR/prune.log</string>
  <key>StandardErrorPath</key><string>$NUMBAT_DIR/prune.log</string>
</dict></plist>
PLIST

  for l in "$LABEL_D" "$LABEL_P"; do
    agent_reload "$l"
  done

  # Verify rather than announce. Both agents are checked for real: the daemon
  # by asking it to serve, the prune agent by asking launchd if it exists.
  sleep 1
  ok=1
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/sources"; then
    say "numbatd is up at http://127.0.0.1:$PORT/"
  else
    warn "numbatd did not respond on port $PORT — check $NUMBAT_DIR/numbatd.log"
    ok=0
  fi
  if is_loaded "$LABEL_P"; then
    say "prune agent $LABEL_P is registered"
  else
    warn "prune agent $LABEL_P did not register"
    ok=0
  fi
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/favicon.ico"; then
    say "icon is being served"
  else
    warn "icon route did not respond — the tab will fall back to the inline SVG"
  fi
  if [ "$ok" = "0" ]; then
    die "install finished with errors — see the warnings above"
  fi
fi

# Only claim to install the fish function when there is a fish config to
# install it into, and only claim success once the file is actually there.
if [ -d "$HOME/.config/fish" ]; then
  say "installing fish function"
  mkdir -p "$HOME/.config/fish/functions"
  sed "s|__PORT__|$PORT|g; s|__DIR__|$NUMBAT_DIR|g" \
    "$(dirname "$0")/shell/nb.fish" > "$HOME/.config/fish/functions/nb.fish"
  if [ -s "$HOME/.config/fish/functions/nb.fish" ]; then
    say "run: nb help"
  else
    die "fish function was not written to $HOME/.config/fish/functions/nb.fish"
  fi
else
  say "no ~/.config/fish — skipping the nb fish function"
fi

say "done"
