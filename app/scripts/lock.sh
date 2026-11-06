#!/bin/sh
# Lock the emulator's screen (the power button, only when the screen is awake).
# Usage: bun run lock. Targets the emulator unless ANDROID_SERIAL is set.
set -e
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
if "$ADB" -s "$SERIAL" shell dumpsys power | grep -q "mWakefulness=Awake"; then
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_POWER
  echo "locked"
else
  echo "already locked"
fi
