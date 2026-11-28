const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// puck:release-signing";

/**
 * Release signing from the environment, read by Gradle at build time, so no path or password is
 * ever written into android/:
 *
 *   PUCK_KEYSTORE_PATH       the release keystore (kept outside the repo, e.g. ~/.config/puck/)
 *   PUCK_KEYSTORE_PASSWORD   its password
 *   PUCK_KEY_ALIAS           the key alias (default "puck")
 *   PUCK_KEY_PASSWORD        the key password (default: the keystore password, as PKCS12 requires)
 *
 * Without PUCK_KEYSTORE_PATH the release build keeps the debug key, so local builds such as
 * `bun run release:install` behave as before.
 */
const RELEASE_CONFIG = `        ${MARKER} (plugins/withReleaseSigning.js)
        release {
            def puckKeystore = System.getenv('PUCK_KEYSTORE_PATH')
            if (puckKeystore) {
                def puckPassword = System.getenv('PUCK_KEYSTORE_PASSWORD')
                if (!puckPassword) throw new GradleException('PUCK_KEYSTORE_PATH is set but PUCK_KEYSTORE_PASSWORD is not')
                storeFile file(puckKeystore)
                storePassword puckPassword
                keyAlias System.getenv('PUCK_KEY_ALIAS') ?: 'puck'
                keyPassword System.getenv('PUCK_KEY_PASSWORD') ?: puckPassword
            }
        }
`;

const RELEASE_USES =
  "signingConfig System.getenv('PUCK_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug";

/** Pure transform of android/app/build.gradle. Idempotent; throws when the template has changed shape. */
function applyReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;

  const configs = /(signingConfigs \{\n)/;
  if (!configs.test(gradle)) throw new Error("withReleaseSigning: no signingConfigs block in app/build.gradle");
  let next = gradle.replace(configs, `$1${RELEASE_CONFIG}`);

  const release = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!release.test(next)) {
    throw new Error("withReleaseSigning: the release build type does not use signingConfigs.debug");
  }
  next = next.replace(release, `$1${RELEASE_USES}`);
  return next;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("withReleaseSigning: app/build.gradle must be Groovy");
    }
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
