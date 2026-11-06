#!/bin/sh
# Run a Maestro flow from .maestro/ on the Android emulator (emulator-5554 only).
# Usage: bun run flow <name> [KEY=VALUE ...]   e.g. bun run flow dev-sample SAMPLE=home
# Prints PASS or FAIL with the log and screenshot paths; Maestro's output stays under .shots/maestro/.
# Named takeScreenshot files are copied to .shots/maestro/<name>.png. Exits 1 on failure.
set -e
APP="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -ge 1 ] || { echo "usage: bun run flow <name> [KEY=VALUE ...]" >&2; exit 2; }
NAME="$1"
shift
FLOW="$APP/.maestro/$NAME.yaml"
[ -f "$FLOW" ] || { echo "no flow at .maestro/$NAME.yaml" >&2; exit 2; }
DEVICE=emulator-5554
export ANDROID_SERIAL="$DEVICE" MAESTRO_CLI_NO_ANALYTICS=1
# Maestro needs Java 17+; the shell may export an older JAVA_HOME, so prefer a JDK 17 when one exists.
JDK17="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
[ -z "$JDK17" ] || JAVA_HOME="$JDK17"
export JAVA_HOME
OUT="$APP/.shots/maestro"
RUN="$OUT/$NAME"
LOG="$OUT/$NAME.log"
mkdir -p "$OUT"
rm -rf "$RUN"

# Turn KEY=VALUE arguments into "-e KEY=VALUE" pairs for maestro.
N=$#
i=0
while [ "$i" -lt "$N" ]; do
  kv="$1"
  shift
  case "$kv" in *=*) ;; *) echo "expected KEY=VALUE, got: $kv" >&2; exit 2 ;; esac
  set -- "$@" -e "$kv"
  i=$((i + 1))
done

set +e
maestro --device "$DEVICE" test --test-output-dir "$RUN" "$@" "$FLOW" > "$LOG" 2>&1
STATUS=$?
set -e

find "$RUN" -path '*/takeScreenshot/*.png' ! -name 'step-*' -exec cp {} "$OUT/" \; 2>/dev/null || true
if [ "$STATUS" -eq 0 ]; then
  echo "PASS $NAME (log: $LOG)"
  find "$RUN" -path '*/takeScreenshot/*.png' ! -name 'step-*' -exec basename {} \; 2>/dev/null | sed "s|^|screenshot: $OUT/|" || true
  exit 0
fi
echo "FAIL $NAME (log: $LOG)"
grep -m1 "FAILED" "$LOG" | sed 's/^ */failed step: /' || true
# Maestro's last step screenshot is the one taken at the failing step.
FAIL_SHOT="$(find "$RUN" -path '*/screenshots/*.png' 2>/dev/null | sort | tail -1 || true)"
if [ -n "$FAIL_SHOT" ]; then
  cp "$FAIL_SHOT" "$OUT/$NAME-failure.png"
  echo "failure screenshot: $OUT/$NAME-failure.png"
fi
exit 1
