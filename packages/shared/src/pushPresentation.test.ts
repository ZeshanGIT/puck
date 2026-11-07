import { describe, expect, test } from "bun:test";
import { pushUsesFullScreenDataMessage } from "./pushPresentation";

describe("pushUsesFullScreenDataMessage", () => {
  test("uses the full-screen data path only when the phone allows it", () => {
    expect(pushUsesFullScreenDataMessage(true)).toBe(true);
    expect(pushUsesFullScreenDataMessage(false)).toBe(false);
  });
});
