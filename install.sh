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
LABEL_D="com.numbat-tools.numbatd"
LABEL_P="com.numbat-tools.prune"
DO_AGENTS=1

say(){ printf '\033[1m›\033[0m %s\n' "$1"; }
die(){ printf 'install.sh: %s\n' "$1" >&2; exit 1; }

for a in "$@"; do
  case "$a" in
    --no-agents) DO_AGENTS=0 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $a" ;;
  esac
done

if [ "${UNINSTALL:-0}" = "1" ]; then
  for l in "$LABEL_D" "$LABEL_P"; do
    [ -f "$AGENTS/$l.plist" ] && launchctl unload "$AGENTS/$l.plist" 2>/dev/null || true
    rm -f "$AGENTS/$l.plist"
  done
  rm -f "$NUMBAT_DIR/bin/numbatd" "$NUMBAT_DIR/bin/numbat-prune" "$NUMBAT_DIR/tools/viewer.html"
  say "removed. Your records in $NUMBAT_DIR were left untouched."
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || say "warning: launchd steps are macOS-only; files will still install"
command -v go >/dev/null 2>&1 || die "go toolchain not found (brew install go)"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

mkdir -p "$NUMBAT_DIR/tools" "$NUMBAT_DIR/bin" "$AGENTS"

say "building numbatd"
( cd "$(dirname "$0")/numbatd" && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$NUMBAT_DIR/bin/numbatd" . )

say "installing viewer and prune"
install -m 644 "$(dirname "$0")/viewer/viewer.html" "$NUMBAT_DIR/tools/viewer.html"
install -m 755 "$(dirname "$0")/prune/numbat-prune" "$NUMBAT_DIR/bin/numbat-prune"

if [ "$DO_AGENTS" = "1" ] && [ "$(uname -s)" = "Darwin" ]; then
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

  launchctl unload "$AGENTS/$LABEL_D.plist" 2>/dev/null || true
  launchctl load  "$AGENTS/$LABEL_D.plist"
  launchctl unload "$AGENTS/$LABEL_P.plist" 2>/dev/null || true
  launchctl load  "$AGENTS/$LABEL_P.plist"

  sleep 1
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/sources"; then
    say "numbatd is up at http://127.0.0.1:$PORT/"
  else
    say "numbatd did not respond — check $NUMBAT_DIR/numbatd.log"
  fi
fi

say "installing fish function (if fish is present)"
if [ -d "$HOME/.config/fish" ]; then
  mkdir -p "$HOME/.config/fish/functions"
  sed "s|__PORT__|$PORT|g; s|__DIR__|$NUMBAT_DIR|g" \
    "$(dirname "$0")/shell/nb.fish" > "$HOME/.config/fish/functions/nb.fish"
  say "run: nb help"
fi

say "done"
