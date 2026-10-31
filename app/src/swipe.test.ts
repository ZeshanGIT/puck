import { describe, expect, test } from "bun:test";
import { SWIPE_COMMIT_PX, swipeCanBegin, swipeChoice } from "./swipe";

const options = [
  { id: "snooze", label: "Snooze" },
  { id: "dismiss", label: "Dismiss" },
];

describe("swipeChoice", () => {
  test("commits past the mark and springs back inside it", () => {
    expect(swipeChoice(-SWIPE_COMMIT_PX, options)).toBe("snooze");
    expect(swipeChoice(SWIPE_COMMIT_PX + 20, options)).toBe("dismiss");
    expect(swipeChoice(-(SWIPE_COMMIT_PX - 1), options)).toBeNull();
    expect(swipeChoice(12, options)).toBeNull();
  });

  test("ignores a touch that arrives already past the mark", () => {
    expect(swipeCanBegin(20, 4)).toBe(true);
    expect(swipeCanBegin(SWIPE_COMMIT_PX, 0)).toBe(false);
    expect(swipeCanBegin(-120, 10)).toBe(false);
    expect(swipeCanBegin(4, 0)).toBe(false);
  });

  test("ignores a swipe that is not two options", () => {
    expect(swipeChoice(-200, [options[0]!])).toBeNull();
    expect(swipeChoice(200, [...options, { id: "later", label: "Later" }])).toBeNull();
  });
});
