#!/bin/sh
# Bypass matrix: alerts from cortana8 that ask for bypass (bypassDnd, bypassSilent), under each global
# DND/silent setting and a per-bot override, with the app alive on Home in the background. Polls the
# notifications every 2 s for 40 s and reports the channel each one posted on. On exit restores global
# Off/Off and cortana8's override to default, and cancels the alerts it sent. Usage: sh scripts/bypass-qa.sh
APP="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$APP/../cli"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
A="$ADB -s ${ANDROID_SERIAL:-emulator-5554}"
BID=cortana8-14286
POLL="$APP/.shots/maestro/bypass-poll.txt"
SENT=""
restore() {
  sh "$APP/scripts/flow.sh" settings-bypass DND=off SILENT=off >/dev/null 2>&1 || echo "restore: global settings flow failed"
  sh "$APP/scripts/flow.sh" bot-bypass BOT=cortana8 DND=default SILENT=default >/dev/null 2>&1 || echo "restore: cortana8 override flow failed"
  for id in $SENT; do (cd "$CLI" && bun run dev -- cancel "$id" --bot "$BID" >/dev/null 2>&1); done
  echo "restored: global off/off, cortana8 override default; cancelled alerts:${SENT:- none}"
}
trap restore EXIT INT TERM
settle() {
  sh "$APP/scripts/flow.sh" settings-bypass DND="$1" SILENT="$2" >/dev/null 2>&1 || { echo "settings flow failed: DND $1 silent $2"; exit 1; }
  $A shell input keyevent KEYCODE_HOME
}
run() {
  QID="$(cd "$CLI" && bun run dev -- send --bot "$BID" --file "$APP/.shots/maestro/$3" | tail -1)"
  SENT="$SENT $QID"
  FIRST=none; CH=""
  for i in $(seq 1 20); do
    $A shell dumpsys notification --noredact > "$POLL" 2>/dev/null
    if [ "$FIRST" = none ] && grep -q "tag=$QID" "$POLL"; then
      FIRST="t=$((i * 2))s"
      CH="$(grep "tag=$QID" "$POLL" | grep -o -m1 'channel=[^ ,)]*' | sed 's/channel=//')"
    fi
    sleep 2
  done
  echo "$1 | expected $2 | actual ${CH:-none} ($FIRST) | $QID"
  (cd "$CLI" && bun run dev -- cancel "$QID" --bot "$BID" >/dev/null 2>&1)
}
settle off off
run "a global DND off, silent off, urgent" puck-urgent alert-urgent-bypass.json
settle all off
run "b DND all, silent off, urgent" puck-urgent-dnd alert-urgent-bypass.json
settle off all
run "c DND off, silent all, urgent" puck-urgent-alarm alert-urgent-bypass.json
settle all all
run "d DND all, silent all, urgent" puck-urgent-bypass alert-urgent-bypass.json
settle urgent urgent
run "e urgent only both, urgent alert" puck-urgent-bypass alert-urgent-bypass.json
run "f urgent only both, NORMAL alert" "no bypass (normal channel)" alert-normal-bypass.json
settle off off
sh "$APP/scripts/flow.sh" bot-bypass BOT=cortana8 DND=all SILENT=default >/dev/null 2>&1 || { echo "cortana8 override flow failed"; exit 1; }
$A shell input keyevent KEYCODE_HOME
run "g global off/off, cortana8 override DND all, urgent" puck-urgent-dnd alert-urgent-bypass.json
