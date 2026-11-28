import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { applyReleaseSigning } = require("./withReleaseSigning.js");

// The shape Expo SDK 58's prebuild writes into android/app/build.gradle.
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe("applyReleaseSigning", () => {
  const out = applyReleaseSigning(TEMPLATE);

  test("adds a release signing config read from the environment", () => {
    expect(out).toContain("release {\n            def puckKeystore = System.getenv('PUCK_KEYSTORE_PATH')");
    expect(out).toContain("keyAlias System.getenv('PUCK_KEY_ALIAS') ?: 'puck'");
  });

  test("release uses it only when PUCK_KEYSTORE_PATH is set; debug stays on the debug key", () => {
    expect(out).toContain(
      "signingConfig System.getenv('PUCK_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
    );
    const debugType = out.slice(out.indexOf("buildTypes {"), out.indexOf("release {", out.indexOf("buildTypes {")));
    expect(debugType).toContain("signingConfig signingConfigs.debug");
  });

  test("never writes a path or password into the file", () => {
    expect(out).not.toMatch(/storePassword '(?!android')/);
    expect(out).not.toContain(".keystore'\n            storePassword System");
  });

  test("is idempotent", () => {
    expect(applyReleaseSigning(out)).toBe(out);
  });

  test("fails loudly when the template changes shape", () => {
    expect(() => applyReleaseSigning("android {}\n")).toThrow("no signingConfigs block");
    const noDebugRelease = TEMPLATE.replace(/(release \{\n[^]*?)signingConfig signingConfigs\.debug/, "$1");
    expect(() => applyReleaseSigning(noDebugRelease)).toThrow("does not use signingConfigs.debug");
  });
});
