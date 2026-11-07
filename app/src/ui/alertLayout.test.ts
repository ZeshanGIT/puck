import { describe, expect, test } from "bun:test";
import { shouldFlowBottom } from "./alertLayout";

const window = 800;

describe("shouldFlowBottom", () => {
  test("normal text and a modest bottom stay pinned", () => {
    expect(shouldFlowBottom({ fontScale: 1, bottomHeight: 360, windowHeight: window })).toBe(false);
  });

  test("text scaled up flows, whatever the bottom's height", () => {
    expect(shouldFlowBottom({ fontScale: 1.3, bottomHeight: 200, windowHeight: window })).toBe(true);
    expect(shouldFlowBottom({ fontScale: 1.05, bottomHeight: 200, windowHeight: window })).toBe(false);
  });

  test("a bottom taller than half the screen flows at normal size (four options with descriptions)", () => {
    expect(shouldFlowBottom({ fontScale: 1, bottomHeight: 401, windowHeight: window })).toBe(true);
    expect(shouldFlowBottom({ fontScale: 1, bottomHeight: 400, windowHeight: window })).toBe(false);
  });
});
