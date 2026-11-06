#!/bin/sh
# Wake the emulator and unlock it.
# Usage: bun run unlock
#   - A swipe lock needs nothing.
#   - A PIN lock: set PUCK_AVD_PIN in your shell first (for example `export PUCK_AVD_PIN=1234`);
#     it is typed with `adb shell input text` and never printed or stored. A pattern lock is not handled.
# Targets the emulator unless ANDROID_SERIAL is set.
set -e
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
adb_() { "$ADB" -s "$SERIAL" "$@"; }
locked() { adb_ shell dumpsys window | grep -q "isKeyguardShowing=true"; }

adb_ shell input keyevent KEYCODE_WAKEUP
sleep 1
adb_ shell wm dismiss-keyguard
sleep 1
if locked; then
  # Bring up the PIN pad (swipe the lock screen up), then type the PIN.
  adb_ shell input swipe 540 2000 540 700 250
  sleep 1
  if locked && [ -n "${PUCK_AVD_PIN:-}" ]; then
    adb_ shell input text "$PUCK_AVD_PIN"
    adb_ shell input keyevent KEYCODE_ENTER
    sleep 2
  fi
fi
if locked; then
  if [ -z "${PUCK_AVD_PIN:-}" ]; then
    echo "still locked: this emulator has a PIN. Run: export PUCK_AVD_PIN=<your pin>  then bun run unlock"
  else
    echo "still locked: the PIN did not work (a pattern lock is not handled)"
  fi
  exit 1
fi
echo "unlocked"
