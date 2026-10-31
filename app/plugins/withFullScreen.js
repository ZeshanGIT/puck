const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/** Manifest flags for an urgent alert over the lock screen. android/ is generated. */
function withFullScreen(config) {
  config = AndroidConfig.Permissions.withPermissions(config, ["android.permission.USE_FULL_SCREEN_INTENT"]);
  return withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity.$["android:showWhenLocked"] = "true";
    activity.$["android:turnScreenOn"] = "true";
    return mod;
  });
}

module.exports = withFullScreen;
