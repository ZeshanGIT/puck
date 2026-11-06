#!/bin/sh
# Open the dev design gallery on the emulator. Usage: bun run gallery [Section]
# (Section = a component title such as Blob, Buttons, "Small components", "Rich text").
# Targets the emulator unless ANDROID_SERIAL is set.
set -e
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
URL="puck://dev-gallery"
if [ -n "$1" ]; then
  ENC="$(printf '%s' "$1" | sed 's/ /%20/g')"
  URL="$URL?section=$ENC"
fi
"$ADB" -s "${ANDROID_SERIAL:-emulator-5554}" shell am start -a android.intent.action.VIEW -d "'$URL'" -n in.puckit.app/.MainActivity > /dev/null
echo "opened $URL"
