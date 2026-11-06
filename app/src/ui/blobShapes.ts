/**
 * Blob data and pure helpers, ported from the prototype's `SHAPES`, `BOTS`,
 * `lifeTick()` and the `.blob` keyframes in
 * `vault/Projects/Puck/mockups/Puck prototype.html`. Plain TypeScript, no React,
 * so the life-loop and keyframe logic can be unit tested.
 */
import type { PaletteName } from "./botTheme";

/** Body path per shape, in a 100 x 100 viewBox. */
export const SHAPES = {
  round: "M50 7C74 6 93 24 93 49C94 75 75 93 50 93C25 94 7 76 7 51C6 26 26 8 50 7Z",
  squircle: "M32 9H68C83 9 91 17 91 32V68C91 83 83 91 68 91H32C17 91 9 83 9 68V32C9 17 17 9 32 9Z",
  hex: "M77.2 20.4L89.8 42.6Q94 50 89.8 57.4L77.2 79.6Q73 87 63.8 87L36.2 87Q27 87 22.8 79.6L10.2 57.4Q6 50 10.2 42.6L22.8 20.4Q27 13 36.2 13L63.8 13Q73 13 77.2 20.4Z",
  bean: "M40 10C62 4 86 16 88 40C90 58 80 66 78 78C75 92 58 96 44 92C24 88 10 72 10 52C10 32 20 15 40 10Z",
  cloud:
    "M30 30C34 14 54 10 64 22C78 16 94 28 90 46C98 58 90 78 74 80C68 94 46 96 38 84C20 88 6 74 12 58C2 46 12 28 30 30Z",
} as const;

export type ShapeName = keyof typeof SHAPES;

export interface BlobBot {
  name: string;
  colour: PaletteName;
  shape: ShapeName;
  /** Body rotation in degrees about (50, 50). */
  tilt: number;
}

/** The prototype's `BOTS` table (name, colour, shape, tilt). */
export const SAMPLE_BOTS = {
  sheldon: { name: "Sheldon", colour: "coral", shape: "squircle", tilt: -7 },
  brow: { name: "Brow", colour: "brown", shape: "bean", tilt: -4 },
  grok: { name: "Grok Bot", colour: "black", shape: "round", tilt: 0 },
  deploy: { name: "Deploy Watch", colour: "teal", shape: "hex", tilt: 6 },
  puck: { name: "Puck", colour: "sky", shape: "round", tilt: 3 },
  cortana: { name: "Cortana", colour: "indigo", shape: "cloud", tilt: -5 },
} as const satisfies Record<string, BlobBot>;

export type SampleBotKey = keyof typeof SAMPLE_BOTS;

/* ---------------- eyes ---------------- */

/** Eye rects, inside a group rotated `EYE_GROUP_ROTATION` degrees about `EYE_GROUP_ORIGIN`. */
export const EYES = [
  { x: 56, y: 25, width: 8.5, height: 20, rx: 4.25 },
  { x: 70, y: 26, width: 8.5, height: 20, rx: 4.25 },
] as const;
export const EYE_GROUP_ROTATION = -12;
export const EYE_GROUP_ORIGIN = { x: 66, y: 36 } as const;

/* ---------------- life loop (prototype `lifeTick`) ---------------- */

/** `setInterval(lifeTick, 1700)`. */
export const LIFE_TICK_MS = 1700;
export const GLANCE_CHANCE = 0.55;
export const BLINK_CHANCE = 0.28;
/** Glance offsets are within +-4 x and +-3 y, in viewBox units. */
export const GLANCE_RANGE = { x: 4, y: 3 } as const;
/** `.blob .eyes{transition:transform .38s var(--spring)}`. */
export const EYE_MOVE_MS = 380;
/** `.blob.blink .eye{animation:blink .17s ease-in-out}`, `50%{transform:scaleY(.12)}`. */
export const BLINK_MS = 170;
export const BLINK_SCALE_Y = 0.12;

export interface Offset {
  x: number;
  y: number;
}

export interface LifeTickResult {
  /** New eye offset in viewBox units, or null to stay put. */
  glance: Offset | null;
  blink: boolean;
}

/** `(Math.random()*8-4).toFixed(1)`: a value in [-range, range), rounded to 0.1. */
export function glanceValue(r: number, range: number): number {
  return Math.round((r * range * 2 - range) * 10) / 10;
}

/**
 * One tick of the prototype's `lifeTick()` for a single blob. Draws random
 * numbers in the same order as the prototype: glance roll, x, y, blink roll.
 * A focused blob (one that is looking at something) neither glances nor blinks.
 */
export function lifeTick(focused: boolean, random: () => number = Math.random): LifeTickResult {
  if (focused) return { glance: null, blink: false };
  let glance: Offset | null = null;
  if (random() < GLANCE_CHANCE) {
    const x = glanceValue(random(), GLANCE_RANGE.x);
    const y = glanceValue(random(), GLANCE_RANGE.y);
    glance = { x, y };
  }
  const blink = random() < BLINK_CHANCE;
  return { glance, blink };
}

/* ---------------- reactions (prototype keyframes) ---------------- */

/** CSS timing functions used by the blob, as cubic-bezier control points. */
export const CURVES = {
  /** `--spring` */
  spring: [0.3, 1.45, 0.5, 1],
  /** `--ease` */
  ease: [0.2, 0.8, 0.2, 1],
  /** CSS `ease-out` */
  easeOut: [0, 0, 0.58, 1],
  /** CSS `ease-in-out` */
  easeInOut: [0.42, 0, 0.58, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type CurveName = keyof typeof CURVES;

/**
 * One keyframe: `translateY(ty px) scale(sx, sy)` plus opacity, at `at` (0 to 1).
 * `ty` is in dp of the blob box (CSS px on the `.blob` div), not viewBox units.
 */
export interface BlobFrame {
  at: number;
  ty: number;
  sx: number;
  sy: number;
  opacity: number;
}

export type ReactionName = "arrive" | "squash" | "leap" | "droop" | "hop";

export interface Reaction {
  durationMs: number;
  curve: CurveName;
  /** First frame at 0, last at 1. CSS applies the curve to each interval. */
  frames: readonly BlobFrame[];
  /** True for droop: a transition that holds its end state instead of returning to rest. */
  holds: boolean;
}

const f = (at: number, ty: number, sx: number, sy: number, opacity = 1): BlobFrame => ({
  at,
  ty,
  sx,
  sy,
  opacity,
});

/** Origin of every reaction: 50% across, 90% down (`.blob{transform-origin:50% 90%}`). */
export const REACTION_ORIGIN = { x: 0.5, y: 0.9 } as const;

export const REACTIONS: Record<ReactionName, Reaction> = {
  // arrive .62s spring both: 0%{translateY(40px) scale(.6); opacity:0} 55%{translateY(-10px) scale(1.04,.97); opacity:1}
  // 78%{translateY(0) scale(.97,1.03)} 100%{none}
  arrive: {
    durationMs: 620,
    curve: "spring",
    holds: false,
    frames: [f(0, 40, 0.6, 0.6, 0), f(0.55, -10, 1.04, 0.97), f(0.78, 0, 0.97, 1.03), f(1, 0, 1, 1)],
  },
  // squash .2s ease-out: 40%{scale(1.07,.9)} 100%{none}
  squash: {
    durationMs: 200,
    curve: "easeOut",
    holds: false,
    frames: [f(0, 0, 1, 1), f(0.4, 0, 1.07, 0.9), f(1, 0, 1, 1)],
  },
  // leap .5s ease: 25%{scale(1.08,.88)} 55%{translateY(-30px) scale(.95,1.06)} 82%{translateY(0) scale(1.06,.93)} 100%{none}
  leap: {
    durationMs: 500,
    curve: "ease",
    holds: false,
    frames: [f(0, 0, 1, 1), f(0.25, 0, 1.08, 0.88), f(0.55, -30, 0.95, 1.06), f(0.82, 0, 1.06, 0.93), f(1, 0, 1, 1)],
  },
  // droop: transform:translateY(8px) scale(1.03,.92); transition:transform .5s ease (held)
  droop: {
    durationMs: 500,
    curve: "ease",
    holds: true,
    frames: [f(1, 8, 1.03, 0.92)],
  },
  // hop .55s spring: 30%{scale(1.06,.9)} 60%{translateY(-18px) scale(.97,1.04)} 100%{none}
  hop: {
    durationMs: 550,
    curve: "spring",
    holds: false,
    frames: [f(0, 0, 1, 1), f(0.3, 0, 1.06, 0.9), f(0.6, -18, 0.97, 1.04), f(1, 0, 1, 1)],
  },
};

export interface Segment {
  to: number;
  durationMs: number;
}

/**
 * Splits a reaction into per-property timing segments. The first segment has
 * duration 0 (jump to the 0% frame, as a restarted CSS animation does); each
 * following segment runs to the next frame over its share of the duration.
 * A held transition (droop) has a single segment from wherever the value is.
 */
export function reactionSegments(reaction: Reaction, key: keyof Omit<BlobFrame, "at">): Segment[] {
  const { frames, durationMs } = reaction;
  if (reaction.holds) {
    return [{ to: frames[frames.length - 1]![key], durationMs }];
  }
  return frames.map((frame, i) => ({
    to: frame[key],
    durationMs: i === 0 ? 0 : Math.round((frame.at - frames[i - 1]!.at) * durationMs),
  }));
}

/** Reduced motion: arrive fades in over this (the prototype's 220 ms screen fade); others don't move. */
export const REDUCED_FADE_MS = 220;
