#!/bin/sh
# Device QA of the live-activity app side (T81 ongoing notification, T82 Working now card) against the real backend,
# cortana8 (unmuted, app process alive). Each change: CLI command, then the puck-live notification is read from
# dumpsys (waiting for the expected text), and for running states the Home card is checked by the live-real flow
# (KEEP=1 keeps the process alive). Leaves the app running on Home. Usage: sh scripts/live-qa.sh
APP="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$APP/../cli"
BACKEND="$APP/../backend"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
A="$ADB -s ${ANDROID_SERIAL:-emulator-5554}"
BOT=cortana8-14286
TMP="$APP/.shots/maestro/live-qa"
mkdir -p "$TMP"
AID=""
cli() { (cd "$CLI" && bun run dev -- status "$@" --bot "$BOT") 2>&1 | tail -1 | sed 's/^/  cli: /'; }
flow() { sh "$APP/scripts/flow.sh" live-real STAGE="$1" KEEP=1 | head -1 | sed 's/^/  flow: /'; $A shell input keyevent KEYCODE_HOME; }
running_id() {
  (cd "$BACKEND" && bunx convex data liveActivities --format jsonLines 2>/dev/null) | python3 -I -c '
import json,sys
ids=[json.loads(l)["_id"] for l in sys.stdin if l.strip().startswith("{") and json.loads(l).get("botId")=="jd70p4ztct2kjfjpcphd9m8x8s8hpb7j" and json.loads(l).get("state")=="running"]
print(ids[-1] if ids else "")'
}
note() {
  $A shell dumpsys notification --noredact > "$TMP/dump.txt" 2>/dev/null
  python3 -I - "$TMP/dump.txt" "live-$AID" "$1" <<'PYEOF'
import sys,re
text=open(sys.argv[1],encoding="utf8",errors="ignore").read().split("\n")
tag,label=sys.argv[2],sys.argv[3]
recs=[i for i,l in enumerate(text) if "NotificationRecord(" in l and "tag="+tag in l]
if not recs:
    print(f"{label} | notifications: 0 (none posted)")
    sys.exit(0)
i=recs[0]; block=[]
for l in text[i:i+80]:
    if block and "NotificationRecord(" in l: break
    block.append(l)
b="\n".join(block)
def field(name):
    m=re.search(name+r"=(?:SpannableString |String |Integer |Boolean )?\(?([^\n\)]*)", b)
    return m.group(1).strip() if m else "-"
flags=re.search(r"flags=([A-Z_|]+)", b)
imp=re.search(r"importance=(\d)", text[i])
chan=re.search(r"channel=([\w-]+)", b)
print(f"{label} | notifications: {len(recs)} | channel {chan.group(1) if chan else '-'} | importance {imp.group(1) if imp else '-'} | flags {flags.group(1) if flags else '-'} | title {field('android.title')} | sub {field('android.subText')} | text {field('android.text')} | progress {field('android.progress')}/{field('android.progressMax')} | chronometer {field('android.showChronometer')}")
PYEOF
}
wait_for() {
  n=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    n="$(note "$1")"
    case "$n" in *"$2"*) echo "$n"; return ;; esac
    sleep 2
  done
  echo "$n   [expected: $2]"
}
echo "== scenario A: steps"
cli start --title "QA deploy" --steps "Build|Test|Ship"
AID="$(running_id)"; echo "  activity $AID"
flow start
wait_for "A1 start" "text Build"
cli step "Running tests"
flow stepped
wait_for "A2 step Running tests" "text Running tests"
cli step "Running lint"
wait_for "A3 step Running lint (midway)" "text Running lint"
cli end --ok
wait_for "A4 end ok" "text Finished"
wait_for "A5 closing gone" "notifications: 0"
flow done
echo "== scenario B: failed"
cli start --title "QA fail" --steps "Build|Test|Ship"
AID="$(running_id)"; echo "  activity $AID"
flow start
wait_for "B1 start" "text Build"
cli step "Running tests"
wait_for "B2 step" "text Running tests"
cli end --failed
wait_for "B3 end failed" "text Didn't finish"
wait_for "B4 closing gone" "notifications: 0"
flow failed
echo "== scenario C: log style"
cli start --title "QA log"
AID="$(running_id)"; echo "  activity $AID"
cli step "line one"
cli step "line two"
flow log
wait_for "C1 two lines" "text line two"
cli end --ok
wait_for "C2 end ok" "text Finished"
wait_for "C3 closing gone" "notifications: 0"
echo "== done"
