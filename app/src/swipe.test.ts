import { describe, expect, test } from "bun:test";
import {
  SWIPE_ARM_DELAY_MS,
  SWIPE_COMMIT_PX,
  swipeArmDelayLeft,
  swipeCanBegin,
  swipeChoice,
  swipeClamp,
  swipeDangerBlend,
  swipeDragMayBegin,
  swipeMax,
  swipeProgress,
  swipeRotation,
  swipeSideAt,
} from "./swipe";

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

describe("live track", () => {
  // A 335 dp wide screen leaves a 332 dp inner track: the knob travels 126 dp each way.
  const max = swipeMax(332);

  test("the knob travels from the middle to 40 dp short of each edge", () => {
    expect(max).toBe(126);
    expect(swipeMax(60)).toBe(0);
  });

  test("a release commits past 72% of the travel and springs back inside it", () => {
    expect(swipeSideAt(max * 0.72 + 1, max)).toBe("right");
    expect(swipeSideAt(-max * 0.72 - 1, max)).toBe("left");
    expect(swipeSideAt(max * 0.72, max)).toBeNull();
    expect(swipeSideAt(-max * 0.5, max)).toBeNull();
    expect(swipeSideAt(500, 0)).toBeNull();
  });

  test("the arm delay is 400 ms from the moment the screen opened", () => {
    expect(SWIPE_ARM_DELAY_MS).toBe(400);
    expect(swipeArmDelayLeft(1000, 1000)).toBe(400);
    expect(swipeArmDelayLeft(1000, 1150)).toBe(250);
    expect(swipeArmDelayLeft(1000, 1400)).toBe(0);
    expect(swipeArmDelayLeft(1000, 9000)).toBe(0);
  });

  test("a drag that is first seen already past the mark is a stale touch", () => {
    expect(swipeDragMayBegin(20, 4, max)).toBe(true);
    expect(swipeDragMayBegin(-20, 4, max)).toBe(true);
    expect(swipeDragMayBegin(max * 0.72, 0, max)).toBe(false);
    expect(swipeDragMayBegin(-max, 2, max)).toBe(false);
    expect(swipeDragMayBegin(4, 0, max)).toBe(false);
    expect(swipeDragMayBegin(20, 40, max)).toBe(false);
    expect(swipeDragMayBegin(20, 0, 0)).toBe(false);
  });

  test("clamp, progress, tilt and the red blend follow the offset", () => {
    expect(swipeClamp(400, max)).toBe(max);
    expect(swipeClamp(-400, max)).toBe(-max);
    expect(swipeClamp(30, max)).toBe(30);
    expect(swipeProgress(-max / 2, max)).toBeCloseTo(0.5);
    expect(swipeProgress(max * 3, max)).toBe(1);
    expect(swipeProgress(10, 0)).toBe(0);
    expect(swipeRotation(max, max)).toBe(10);
    expect(swipeRotation(-max / 2, max)).toBeCloseTo(-5);
    expect(swipeDangerBlend(max * 0.4, max)).toBeCloseTo(0.5);
    expect(swipeDangerBlend(max * 0.8, max)).toBe(1);
  });
});
