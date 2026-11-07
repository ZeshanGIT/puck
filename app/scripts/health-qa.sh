#!/bin/sh
# Alert-health checks with real permission changes: POST_NOTIFICATIONS (pm) and the full-screen intent (appops).
# Runs settings-health for the good state, each broken state and the good state again. Records the starting
# permission state and restores it on exit, even when a phase fails. Usage: sh scripts/health-qa.sh
APP="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || ADB="$(command -v adb)"
PKG=in.puckit.app
A="$ADB -s ${ANDROID_SERIAL:-emulator-5554}"
NOTIF_START="$($A shell dumpsys package $PKG | grep -o -m1 'POST_NOTIFICATIONS: granted=[a-z]*' | sed 's/.*granted=//' | tr -d '\r')"
FS_START="$($A shell appops get $PKG USE_FULL_SCREEN_INTENT | awk -F': ' '{print $2}' | awk '{print $1}' | tr -d '\r;')"
restore() {
  if [ "$NOTIF_START" = "true" ]; then
    $A shell pm grant $PKG android.permission.POST_NOTIFICATIONS
  else
    $A shell pm revoke $PKG android.permission.POST_NOTIFICATIONS
  fi
  $A shell appops set $PKG USE_FULL_SCREEN_INTENT "${FS_START:-default}"
  echo "restored: notifications granted=$NOTIF_START, full-screen=${FS_START:-default}"
}
trap restore EXIT INT TERM
FAIL=0
phase() { sh "$APP/scripts/flow.sh" settings-health EXPECT="$1" || FAIL=1; }
echo "start: notifications granted=$NOTIF_START, full-screen=${FS_START:-default}"
$A shell pm grant $PKG android.permission.POST_NOTIFICATIONS
$A shell appops set $PKG USE_FULL_SCREEN_INTENT allow
phase ok
$A shell pm revoke $PKG android.permission.POST_NOTIFICATIONS
phase bad-notifications
$A shell pm grant $PKG android.permission.POST_NOTIFICATIONS
phase ok
$A shell appops set $PKG USE_FULL_SCREEN_INTENT deny
phase bad-fullscreen
$A shell appops set $PKG USE_FULL_SCREEN_INTENT allow
phase ok
exit $FAIL
