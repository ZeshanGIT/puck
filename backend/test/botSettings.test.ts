import { describe, expect, test } from "bun:test";
import { BOT_COLOURS } from "@puck/shared";
import { alertPushMode, isMuted, tallyWaiting, validateBotColour, validateMutedUntil } from "../convex/lib/botSettings";

const NOW = 1_000_000;

describe("mute", () => {
  test("a bot is muted while mutedUntil is in the future", () => {
    expect(isMuted(NOW + 1, NOW)).toBe(true);
    expect(isMuted(undefined, NOW)).toBe(false);
  });

  test("a mute that ends exactly now, or earlier, is over", () => {
    expect(isMuted(NOW, NOW)).toBe(false);
    expect(isMuted(NOW - 1, NOW)).toBe(false);
  });

  test("a muted bot's alerts are not pushed, a bot not muted is", () => {
    expect(alertPushMode({ mutedUntil: NOW + 60_000 }, NOW)).toBe("muted");
    expect(alertPushMode({ mutedUntil: NOW }, NOW)).toBe("push");
    expect(alertPushMode({}, NOW)).toBe("push");
  });
});

describe("validateBotColour", () => {
  test("accepts every palette colour", () => {
    for (const colour of BOT_COLOURS) expect(validateBotColour(colour)).toBe(colour);
  });

  test("rejects anything else, including other casings", () => {
    expect(() => validateBotColour("Indigo")).toThrow(/colour must be one of/);
    expect(() => validateBotColour("purple")).toThrow(/colour must be one of/);
    expect(() => validateBotColour(3)).toThrow(/colour must be one of/);
  });
});

describe("validateMutedUntil", () => {
  test("accepts a future time, and null to unmute", () => {
    expect(validateMutedUntil(NOW + 1, NOW)).toBe(NOW + 1);
    expect(validateMutedUntil(null, NOW)).toBeNull();
  });

  test("rejects a past or present time, a fraction, and a string", () => {
    expect(() => validateMutedUntil(NOW, NOW)).toThrow(/future/);
    expect(() => validateMutedUntil(NOW - 5, NOW)).toThrow(/future/);
    expect(() => validateMutedUntil(NOW + 0.5, NOW)).toThrow(/future/);
    expect(() => validateMutedUntil(String(NOW + 1), NOW)).toThrow(/future/);
  });
});

describe("tallyWaiting", () => {
  test("counts pending and snoozed alerts per bot, not answered, cancelled or scheduled ones", () => {
    const counts = tallyWaiting(
      [
        { botId: "a", status: "pending" },
        { botId: "a", status: "snoozed" },
        { botId: "b", status: "pending", expiresAt: NOW + 5 },
        { botId: "b", status: "pending", expiresAt: NOW - 5 },
        { botId: "a", status: "answered" },
        { botId: "a", status: "cancelled" },
        { botId: "a", status: "scheduled" },
      ],
      NOW,
    );
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBeUndefined();
  });
});
