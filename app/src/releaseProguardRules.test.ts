import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SNIPPET = join(import.meta.dir, "..", "plugins", "work-manager-proguard-rules.pro");

describe("release ProGuard rules (WorkManager/Room)", () => {
  test("snippet exists and keeps reflective constructors", () => {
    expect(existsSync(SNIPPET)).toBe(true);
    const rules = readFileSync(SNIPPET, "utf8");
    expect(rules).toContain("extends androidx.room.RoomDatabase { <init>(); }");
    expect(rules).toContain("extends androidx.work.InputMerger { <init>(); }");
  });
});
