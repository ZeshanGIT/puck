#!/bin/sh
# Pairing helper for the Maestro pairing flows: runs `puck add` in the background.
# Usage:
#   sh scripts/pair-cli.sh start <name> <colour>   start `puck add <name> --colour <colour>`
#   sh scripts/pair-cli.sh wait <name>             wait up to 90 s for it to finish; print a VERDICT line
#   sh scripts/pair-cli.sh stop <name>             stop it if it is still running
# Output: .shots/maestro/<name>.cli.log (the PID is in <name>.cli.pid). The webhook values are for a test hook.
set -e
APP="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$APP/../cli"
OUT="$APP/.shots/maestro"
mkdir -p "$OUT"
CMD="${1:-}"
NAME="${2:-}"
[ -n "$NAME" ] || { echo "usage: pair-cli.sh start|wait|stop <name> [colour]" >&2; exit 2; }
LOG="$OUT/$NAME.cli.log"
PIDF="$OUT/$NAME.cli.pid"
case "$CMD" in
  start)
    COLOUR="${3:?usage: pair-cli.sh start <name> <colour>}"
    ( cd "$CLI" && exec env \
        PUCK_WEBHOOK_URL=https://example.com/puck-test-hook \
        PUCK_WEBHOOK_HEADER='Authorization: Bearer puck-test-token' \
        bun run dev -- add "$NAME" --colour "$COLOUR" ) < /dev/null > "$LOG" 2>&1 &
    echo $! > "$PIDF"
    echo "started puck add $NAME (pid $!), log $LOG"
    ;;
  wait)
    PID="$(cat "$PIDF" 2>/dev/null || true)"
    i=0
    while [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && [ "$i" -lt 90 ]; do
      sleep 1
      i=$((i + 1))
    done
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "still running after 90 s: $NAME (use stop)"
      exit 1
    fi
    tail -n 3 "$LOG"
    if grep -q '^approved' "$LOG"; then
      echo "VERDICT $NAME: approved"
      exit 0
    fi
    echo "VERDICT $NAME: not approved"
    exit 1
    ;;
  stop)
    PID="$(cat "$PIDF" 2>/dev/null || true)"
    [ -z "$PID" ] || kill "$PID" 2>/dev/null || true
    pkill -f "add $NAME --colour" 2>/dev/null || true
    echo "stopped $NAME"
    ;;
  *)
    echo "usage: pair-cli.sh start|wait|stop <name> [colour]" >&2
    exit 2
    ;;
esac
