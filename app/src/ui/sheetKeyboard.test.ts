import { describe, expect, test } from "bun:test";
import { sheetKeyboardBottomInset, sheetMaxHeightWhenKeyboardOpen } from "./sheetKeyboard";

describe("sheetKeyboardBottomInset", () => {
  test("returns zero when disabled", () => {
    expect(sheetKeyboardBottomInset(320, false)).toBe(0);
  });

  test("returns keyboard height when enabled", () => {
    expect(sheetKeyboardBottomInset(320, true)).toBe(320);
  });

  test("returns zero for non-positive height", () => {
    expect(sheetKeyboardBottomInset(0, true)).toBe(0);
  });
});

describe("sheetMaxHeightWhenKeyboardOpen", () => {
  test("returns undefined when keyboard is hidden", () => {
    expect(sheetMaxHeightWhenKeyboardOpen(800, 0, true)).toBeUndefined();
  });

  test("caps height below the window minus keyboard", () => {
    expect(sheetMaxHeightWhenKeyboardOpen(800, 300, true, 48)).toBe(452);
  });

  test("never goes below 160", () => {
    expect(sheetMaxHeightWhenKeyboardOpen(400, 350, true, 48)).toBe(160);
  });
});
