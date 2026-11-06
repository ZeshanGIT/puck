import { describe, expect, test } from "bun:test";
import { needsUnlock } from "./unlock";

const plain = {
  options: [
    { id: "keep" },
    { id: "roll", tone: "destructive" },
  ],
};

describe("needsUnlock", () => {
  test("an unlocked phone never needs it", () => {
    expect(needsUnlock({ ...plain, requiresUnlock: true }, ["roll"], false)).toBe(false);
  });

  test("ordinary options on the lock screen do not ask", () => {
    expect(needsUnlock(plain, ["keep"], true)).toBe(false);
    expect(needsUnlock(plain, [], true)).toBe(false);
  });

  test("a destructive option asks", () => {
    expect(needsUnlock(plain, ["roll"], true)).toBe(true);
    expect(needsUnlock(plain, ["keep", "roll"], true)).toBe(true);
  });

  test("requiresUnlock asks for every option and a custom reply", () => {
    const marked = { ...plain, requiresUnlock: true };
    expect(needsUnlock(marked, ["keep"], true)).toBe(true);
    expect(needsUnlock(marked, [], true)).toBe(true);
  });

  test("an unknown option id is not destructive", () => {
    expect(needsUnlock(plain, ["nope"], true)).toBe(false);
  });
});
