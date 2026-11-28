import { describe, expect, test } from "bun:test";
import { deriveAlertOwner, ownerMayAccess } from "../convex/lib/ownership";

describe("deriveAlertOwner", () => {
  test("a stored alert owner wins over the bot's", () => {
    expect(deriveAlertOwner({ alertUserId: "user_a", bot: { userId: "user_b" } })).toBe("user_a");
  });

  test("without a stored owner it is the bot's owner", () => {
    expect(deriveAlertOwner({ bot: { userId: "user_b" } })).toBe("user_b");
  });

  test("the built-in bot has no owner of its own: it is the target client's user", () => {
    const bot = { builtIn: true };
    expect(deriveAlertOwner({ bot, targetClientUserId: "user_a" })).toBe("user_a");
    expect(deriveAlertOwner({ bot })).toBeNull();
    // A built-in row that somehow carries a userId is still not used for its test pages.
    expect(deriveAlertOwner({ bot: { builtIn: true, userId: "user_x" }, targetClientUserId: "user_a" })).toBe("user_a");
  });

  test("a stored owner on a built-in test page still wins", () => {
    expect(deriveAlertOwner({ alertUserId: "user_a", bot: { builtIn: true }, targetClientUserId: "user_b" })).toBe("user_a");
  });

  test("a bot with no owner, a missing bot or an empty owner is nobody's", () => {
    expect(deriveAlertOwner({ bot: {} })).toBeNull();
    expect(deriveAlertOwner({ bot: null })).toBeNull();
    expect(deriveAlertOwner({ alertUserId: "", bot: { userId: "" } })).toBeNull();
    // A target client does not give an ordinary bot's alert an owner.
    expect(deriveAlertOwner({ bot: {}, targetClientUserId: "user_a" })).toBeNull();
  });
});

describe("ownerMayAccess", () => {
  test("a user reaches only their own alerts", () => {
    expect(ownerMayAccess("user_a", { kind: "user", userId: "user_a" })).toBe(true);
    expect(ownerMayAccess("user_a", { kind: "user", userId: "user_b" })).toBe(false);
  });

  test("an alert with no owner is visible to no user (fail closed)", () => {
    expect(ownerMayAccess(null, { kind: "user", userId: "user_a" })).toBe(false);
  });

  test("the legacy device reaches only ownerless alerts", () => {
    expect(ownerMayAccess(null, { kind: "device" })).toBe(true);
    expect(ownerMayAccess("user_a", { kind: "device" })).toBe(false);
  });
});
