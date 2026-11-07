#!/bin/sh
# Capture dev-sample screens under an accessibility mode on the Android emulator (emulator-5554 only).
# Usage: sh scripts/a11y-capture.sh <mode> [sample ...]
#   modes:
#     M0    light, font scale 1.0 (reference)
#     M1    dark (cmd uimode night yes), font 1.0
#     M2    light, font scale 1.3
#     M3    dark, font scale 1.3
#     M2x15 light, font scale 1.5 (stress run, kept separate from M2)
#     M4    light, animator_duration_scale and transition_animation_scale 0; every sample is shot
#           twice, 700 ms apart, and the two PNGs are compared (motion report in a11y-motion file)
#     N1    light system, but the alert forms opened with &theme=night (the lock-screen night look);
#           default samples are the alert forms only
#   samples: names from src/screens/gallery/samples (sheldon, home, bot, ...), or gallery:<Section>
#            with spaces written as +, for example gallery:Small+components. With no samples given,
#            the default set for the mode is used (M4: alerts and home/live only).
# Output: .shots/a11y/<mode>-<sample>.png (M4 also <mode>-<sample>-2.png and <mode>-motion.txt).
# Every setting is restored on exit, including on INT/TERM (trap), and the app is force-stopped.
# The emulator must already be awake and unlocked; the script refuses to run on a lock screen and
# never types a PIN or password.
set -u

APP="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE=emulator-5554
PKG=in.puckit.app
DEV_CLIENT_URL="puck://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
OUT="$APP/.shots/a11y"

dadb() { "$ADB" -s "$DEVICE" "$@"; }

MODE="${1:?usage: sh scripts/a11y-capture.sh <mode> [sample ...]}"
shift

case "$MODE" in
  M0)    NIGHT=no;  FONT=1.0 ;;
  M1)    NIGHT=yes; FONT=1.0 ;;
  M2)    NIGHT=no;  FONT=1.3 ;;
  M3)    NIGHT=yes; FONT=1.3 ;;
  M2x15) NIGHT=no;  FONT=1.5 ;;
  M4)    NIGHT=no;  FONT=1.0 ;;
  N1)    NIGHT=no;  FONT=1.0 ;;
  *) echo "unknown mode: $MODE (M0 M1 M2 M3 M2x15 M4 N1)" >&2; exit 2 ;;
esac
# Extra query for dev-alert links: N1 forces the night look on the alert forms, every other mode follows the system.
THEME_PARAM=""
[ "$MODE" = N1 ] && THEME_PARAM="&theme=night"

ALERTS="sheldon fyi brow-multi deploy-watch wake reply-demo expiring three-at-once three-with-cancel"
HOME_SET="home home-clear home-empty home-pairing live-steps live-log live-none live-done"
DETAIL_SET="detail detail-ok"
PAIR_SET="pair-code pair-approve pair-approve-nocolour pair-meet"
BOTS_SET="bots bots-empty bot bot-muted"
SETTINGS_SET="settings this-phone clients sounds health health-ok about"
GALLERY_SET="gallery:Blob gallery:Buttons gallery:Small+components gallery:Rich+text"

mkdir -p "$OUT"
if [ "$MODE" = M4 ]; then
  DEFAULT="$ALERTS $HOME_SET"
elif [ "$MODE" = N1 ]; then
  DEFAULT="$ALERTS"
else
  DEFAULT="$ALERTS $HOME_SET $DETAIL_SET $PAIR_SET $BOTS_SET $SETTINGS_SET $GALLERY_SET"
fi
[ $# -gt 0 ] || set -- $DEFAULT

# Remember the original values so the restore puts back exactly what was there.
ORIG_FONT="$(dadb shell settings get system font_scale | tr -d '\r')"
ORIG_NIGHT="$(dadb shell cmd uimode night | tr -d '\r' | sed 's/.*: *//')"
ORIG_ANIM="$(dadb shell settings get global animator_duration_scale | tr -d '\r')"
ORIG_TRANS="$(dadb shell settings get global transition_animation_scale | tr -d '\r')"

# Refuse to run on a lock screen: the caller unlocks the emulator, this script never types a PIN.
if dadb shell dumpsys window | grep -q "mDreamingLockscreen=true\|isKeyguardShowing=true\|mShowingLockscreen=true"; then
  echo "emulator is on the lock screen; unlock it by hand and rerun" >&2
  exit 3
fi

RESTORED=0
restore() {
  [ "$RESTORED" = 1 ] && return 0
  RESTORED=1
  dadb shell cmd uimode night "$ORIG_NIGHT" >/dev/null 2>&1
  dadb shell settings put system font_scale "$ORIG_FONT"
  if [ "$ORIG_ANIM" = null ]; then
    dadb shell settings delete global animator_duration_scale >/dev/null
  else
    dadb shell settings put global animator_duration_scale "$ORIG_ANIM"
  fi
  if [ "$ORIG_TRANS" = null ]; then
    dadb shell settings delete global transition_animation_scale >/dev/null
  else
    dadb shell settings put global transition_animation_scale "$ORIG_TRANS"
  fi
  dadb shell am force-stop "$PKG"
  echo "restored: font_scale=$(dadb shell settings get system font_scale | tr -d '\r') night=$(dadb shell cmd uimode night | tr -d '\r' | sed 's/.*: *//') animator=$(dadb shell settings get global animator_duration_scale | tr -d '\r') transition=$(dadb shell settings get global transition_animation_scale | tr -d '\r')"
}
trap restore EXIT
trap 'restore; exit 130' INT TERM

# Apply the mode.
dadb shell cmd uimode night "$NIGHT" >/dev/null
dadb shell settings put system font_scale "$FONT"
if [ "$MODE" = M4 ]; then
  dadb shell settings put global animator_duration_scale 0
  dadb shell settings put global transition_animation_scale 0
fi

# Start the dev client on Metro so it reads the new font scale and theme; the bundle takes a while.
launch() {
  dadb shell am force-stop "$PKG"
  dadb shell am start -a android.intent.action.VIEW -d "$DEV_CLIENT_URL" "$PKG" >/dev/null
  sleep 30
}

open_sample() {
  case "$1" in
    gallery:*)
      sec="$(printf '%s' "${1#gallery:}" | tr '+' ' ' | sed 's/ /%20/g')"
      url="puck://dev-gallery?section=$sec" ;;
    *) url="puck://dev-alert?sample=$1$THEME_PARAM" ;;
  esac
  # The device shell splits an unquoted & (the theme=night query), so the URL is quoted for it.
  dadb shell "am start -a android.intent.action.VIEW -d '$url' $PKG" >/dev/null
}

shot() { dadb exec-out screencap -p > "$1"; }

launch
MOTION="$OUT/$MODE-motion.txt"
[ "$MODE" = M4 ] && : > "$MOTION"
echo "mode $MODE: night=$NIGHT font=$FONT (was night=$ORIG_NIGHT font=$ORIG_FONT anim=$ORIG_ANIM/$ORIG_TRANS)"

for s in "$@"; do
  # The dev gallery only opens from a fresh launch (an open sample screen keeps it closed), so relaunch first.
  case "$s" in gallery:*) launch ;; esac
  open_sample "$s"
  sleep 3
  name="$(printf '%s' "$s" | tr '+' '-' | sed 's|^gallery:|gallery-|')"
  first="$OUT/$MODE-$name.png"
  shot "$first"
  if [ "$MODE" = M4 ]; then
    sleep 0.7
    second="$OUT/$MODE-$name-2.png"
    shot "$second"
    if cmp -s "$first" "$second"; then
      echo "$name: still" >> "$MOTION"
    else
      echo "$name: CHANGED between shots, differing bytes=$(cmp -l "$first" "$second" 2>/dev/null | wc -l | tr -d ' ')" >> "$MOTION"
    fi
  fi
  echo "$first"
done

[ "$MODE" = M4 ] && echo "motion report: $MOTION"
exit 0
