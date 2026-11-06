import { describe, expect, test } from "bun:test";
import {
  BUILT_IN_BOT_ID,
  TEST_PAGE_FRESH_MS,
  TEST_PAGE_OPTIONS,
  botMayAuthenticate,
  decideTestPage,
  deliveryRoute,
  isBuiltInBot,
} from "../convex/lib/builtInBot";

const NOW = 1_800_000_000_000;

describe("decideTestPage", () => {
  test("creates when nothing is pending", () => {
    expect(decideTestPage([], NOW)).toEqual({ action: "create", cancel: [] });
  });

  test("reuses a fresh pending test page", () => {
    expect(decideTestPage([{ questionId: "q_AAAAAAAAAA", createdAt: NOW - 5_000 }], NOW)).toEqual({
      action: "reuse",
      questionId: "q_AAAAAAAAAA",
    });
  });

  test("reuses the newest when several are fresh", () => {
    const decision = decideTestPage(
      [
        { questionId: "q_old", createdAt: NOW - 30_000 },
        { questionId: "q_new", createdAt: NOW - 1_000 },
      ],
      NOW,
    );
    expect(decision).toEqual({ action: "reuse", questionId: "q_new" });
  });

  test("cancels stale ones and creates a new page", () => {
    const decision = decideTestPage(
      [
        { questionId: "q_a", createdAt: NOW - TEST_PAGE_FRESH_MS - 1 },
        { questionId: "q_b", createdAt: NOW - TEST_PAGE_FRESH_MS },
      ],
      NOW,
    );
    expect(decision).toEqual({ action: "create", cancel: ["q_a", "q_b"] });
  });

  test("a page exactly at the limit is stale", () => {
    expect(decideTestPage([{ questionId: "q_a", createdAt: NOW - TEST_PAGE_FRESH_MS }], NOW).action).toBe("create");
  });
});

describe("built-in bot rules", () => {
  test("only builtIn true is the built-in bot", () => {
    expect(isBuiltInBot({ builtIn: true })).toBe(true);
    expect(isBuiltInBot({ builtIn: false })).toBe(false);
    expect(isBuiltInBot({})).toBe(false);
    expect(isBuiltInBot(null)).toBe(false);
  });

  test("answers to the built-in bot skip the webhook; others POST", () => {
    expect(deliveryRoute({ builtIn: true })).toBe("built-in");
    expect(deliveryRoute({ builtIn: false })).toBe("webhook");
    expect(deliveryRoute({})).toBe("webhook");
  });

  test("the built-in bot cannot authenticate", () => {
    expect(botMayAuthenticate({ builtIn: true })).toBe(false);
    expect(botMayAuthenticate({})).toBe(true);
  });

  test("the id is stable and the test options are valid", () => {
    expect(BUILT_IN_BOT_ID).toBe("puck-builtin");
    expect(TEST_PAGE_OPTIONS.map((option) => option.id)).toEqual(["yes", "no"]);
  });
});
