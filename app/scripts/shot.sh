#!/bin/sh
# Screenshot the connected Android device or emulator into app/.shots/.
# Usage: bun run shot [name]   (default name: latest). Prints the file path.
set -e
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.shots"
mkdir -p "$DIR"
OUT="$DIR/${1:-latest}.png"
"$ADB" exec-out screencap -p > "$OUT"
echo "$OUT"
