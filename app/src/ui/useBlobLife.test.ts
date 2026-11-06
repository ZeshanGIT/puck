import { describe, expect, test } from "bun:test";
// The pure life-loop and keyframe helpers live in blobShapes so they load without React Native.
import {
  REACTIONS,
  SAMPLE_BOTS,
  SHAPES,
  glanceValue,
  lifeTick,
  reactionSegments,
} from "./blobShapes";

const seq = (...values: number[]) => {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error("ran out of random numbers");
    return v;
  };
};

describe("glanceValue", () => {
  test("maps [0, 1) to [-range, range) rounded to 0.1", () => {
    expect(glanceValue(0, 4)).toBe(-4);
    expect(glanceValue(0.5, 4)).toBe(0);
    expect(glanceValue(0.999, 4)).toBe(4);
    expect(glanceValue(0.26, 3)).toBe(-1.4);
  });
});

describe("lifeTick", () => {
  test("glances under 55% and blinks under 28%", () => {
    expect(lifeTick(false, seq(0.54, 1, 0, 0.27))).toEqual({ glance: { x: 4, y: -3 }, blink: true });
  });
  test("no glance at 55%, no blink at 28%", () => {
    expect(lifeTick(false, seq(0.55, 0.28))).toEqual({ glance: null, blink: false });
  });
  test("a focused blob does nothing and draws no numbers", () => {
    expect(lifeTick(true, seq())).toEqual({ glance: null, blink: false });
  });
  test("offsets stay within +-4 x and +-3 y", () => {
    for (let i = 0; i < 500; i++) {
      const { glance } = lifeTick(false);
      if (!glance) continue;
      expect(Math.abs(glance.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(glance.y)).toBeLessThanOrEqual(3);
    }
  });
});

describe("reactions", () => {
  test("segment durations add up to the reaction duration", () => {
    for (const r of Object.values(REACTIONS)) {
      const total = reactionSegments(r, "ty").reduce((a, s) => a + s.durationMs, 0);
      expect(total).toBe(r.durationMs);
    }
  });
  test("arrive starts small, low and transparent and ends at rest", () => {
    const ty = reactionSegments(REACTIONS.arrive, "ty");
    expect(ty[0]).toEqual({ to: 40, durationMs: 0 });
    expect(ty.map((s) => s.durationMs)).toEqual([0, 341, 143, 136]);
    expect(reactionSegments(REACTIONS.arrive, "opacity")[0]!.to).toBe(0);
    expect(ty[ty.length - 1]!.to).toBe(0);
  });
  test("droop is a single held transition", () => {
    expect(reactionSegments(REACTIONS.droop, "sy")).toEqual([{ to: 0.92, durationMs: 500 }]);
  });
  test("non-droop reactions return to rest", () => {
    for (const r of [REACTIONS.arrive, REACTIONS.squash, REACTIONS.leap, REACTIONS.hop]) {
      const last = r.frames[r.frames.length - 1]!;
      expect(last).toMatchObject({ at: 1, ty: 0, sx: 1, sy: 1, opacity: 1 });
    }
  });
});

describe("sample bots", () => {
  test("six bots with the prototype tilts and known shapes", () => {
    expect(Object.values(SAMPLE_BOTS).map((b) => b.tilt)).toEqual([-7, -4, 0, 6, 3, -5]);
    for (const b of Object.values(SAMPLE_BOTS)) expect(SHAPES[b.shape]).toBeDefined();
  });
});
