import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "assets");

const REQUIRED = [
  "icon.png",
  "android-icon-foreground.png",
  "android-icon-background.png",
  "android-icon-monochrome.png",
  "puck-blob-icon.svg",
] as const;

describe("launcher icon assets", () => {
  for (const name of REQUIRED) {
    test(`${name} exists and is non-empty`, () => {
      const path = join(ROOT, name);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path).length).toBeGreaterThan(100);
    });
  }

  test("committed SVG matches generated puck blob markup", () => {
    const svg = readFileSync(join(ROOT, "puck-blob-icon.svg"), "utf8");
    expect(svg).toContain('fill="#3d8fd6"');
    expect(svg).toContain("M50 7C74 6");
  });
});
