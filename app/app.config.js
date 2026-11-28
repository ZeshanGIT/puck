/**
 * app.json plus the version stamps the release script passes in. Without them nothing changes,
 * so local and dev builds keep app.json's version and versionCode.
 *
 *   PUCK_VERSION_NAME          Android versionName, e.g. "1.0.0+abc1234"
 *   PUCK_ANDROID_VERSION_CODE  Android versionCode, a positive integer that must keep rising
 */
module.exports = ({ config }) => {
  const name = process.env.PUCK_VERSION_NAME?.trim();
  const codeRaw = process.env.PUCK_ANDROID_VERSION_CODE?.trim();
  let versionCode;
  if (codeRaw) {
    versionCode = Number(codeRaw);
    if (!Number.isInteger(versionCode) || versionCode < 1) {
      throw new Error(`PUCK_ANDROID_VERSION_CODE must be a positive integer, got "${codeRaw}"`);
    }
  }
  return {
    ...config,
    ...(name ? { version: name } : {}),
    android: { ...config.android, ...(versionCode ? { versionCode } : {}) },
  };
};
