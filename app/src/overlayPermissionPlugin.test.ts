import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = readFileSync(join(import.meta.dir, "..", "plugins", "withFullScreen.js"), "utf8");

describe("overlay permission", () => {
  test("the manifest declares SYSTEM_ALERT_WINDOW for the compact card", () => {
    expect(PLUGIN).toContain('"android.permission.SYSTEM_ALERT_WINDOW"');
  });

  test("the app never grants it: no code path sets appOps or opens a grant without the person", () => {
    expect(PLUGIN).not.toMatch(/appops|grantPermission|GRANT_RUNTIME/iu);
  });
});
