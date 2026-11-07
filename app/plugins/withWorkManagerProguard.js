const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SNIPPET_NAME = "work-manager-proguard-rules.pro";
const MARKER = "androidx.room.RoomDatabase";

/**
 * Appends WorkManager/Room keep rules for release R8 (Notifee → work-runtime).
 * android/ is generated; rules live in repo under plugins/.
 */
function withWorkManagerProguard(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const root = config.modRequest.platformProjectRoot;
      const proguardPath = path.join(root, "app/proguard-rules.pro");
      const snippetPath = path.join(__dirname, SNIPPET_NAME);
      const snippet = fs.readFileSync(snippetPath, "utf8");
      let contents = fs.existsSync(proguardPath) ? fs.readFileSync(proguardPath, "utf8") : "";
      if (!contents.includes(MARKER)) {
        fs.writeFileSync(proguardPath, `${contents.trimEnd()}\n\n${snippet}`);
      }
      return config;
    },
  ]);
}

module.exports = withWorkManagerProguard;
