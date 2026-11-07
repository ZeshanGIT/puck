#!/bin/sh
# Keep the Android emulator awake (AVD dev setting; the lock PIN is untouched). Usage: bun run awake
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
"$ADB" -s "$SERIAL" shell svc power stayon true
"$ADB" -s "$SERIAL" shell settings put system screen_off_timeout 2147483647
echo "keep-awake on $SERIAL"
