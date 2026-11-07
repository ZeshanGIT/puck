const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/**
 * Manifest flags for an urgent alert over the lock screen. android/ is generated.
 * ACCESS_NOTIFICATION_POLICY is what lists Puck under Do Not Disturb access, which the DND
 * bypass needs (Q6). Both are install-time permissions: there is no prompt.
 * SYSTEM_ALERT_WINDOW lets the compact alert card draw over other apps. It is never granted here:
 * the person switches it on in Android's "Display over other apps" page (Preferences).
 */
function withFullScreen(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.USE_FULL_SCREEN_INTENT",
    "android.permission.ACCESS_NOTIFICATION_POLICY",
    "android.permission.SYSTEM_ALERT_WINDOW",
  ]);
  return withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity.$["android:showWhenLocked"] = "true";
    activity.$["android:turnScreenOn"] = "true";
    return mod;
  });
}

module.exports = withFullScreen;
