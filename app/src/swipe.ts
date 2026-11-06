/** Let-go distance, in pixels, from the gesture-choice mockup. A shorter pull springs back. */
export const SWIPE_COMMIT_PX = 68;

/**
 * A real drag starts inside the mark. A touch that is already past it when the
 * screen appears is the tap that opened the app, and must not send an answer.
 */
export function swipeCanBegin(dx: number, dy: number): boolean {
  const distance = Math.abs(dx);
  return distance > 8 && distance < SWIPE_COMMIT_PX && distance > Math.abs(dy);
}

/**
 * The first option sits on the left and the second on the right.
 * A release inside the mark does not commit.
 */
export function swipeChoice(dx: number, options: readonly { id: string }[]): string | null {
  const left = options[0];
  const right = options[1];
  if (!left || !right || options.length !== 2) return null;
  if (dx <= -SWIPE_COMMIT_PX) return left.id;
  if (dx >= SWIPE_COMMIT_PX) return right.id;
  return null;
}

/* ------------------------------------------------------------------------------------------
 * The live A3 track (`SwipeTrack`). Numbers copied from `wireSwipe()` and `.track`/`.knob` in
 * `vault/Projects/Puck/mockups/Puck prototype.html`. These are pure and marked as worklets so the
 * pan gesture can call them on the UI thread; a worklet is an ordinary function in tests.
 * ---------------------------------------------------------------------------------------- */

export type SwipeSide = "left" | "right";

/** `if(Date.now()-S.armedAt<400) return;`: the track ignores the knob for 400 ms after the screen opens. */
export const SWIPE_ARM_DELAY_MS = 400;
/** `Math.abs(dx)>max*.72`: a release past this share of the travel commits. */
export const SWIPE_COMMIT_FRACTION = 0.72;
/** `max = tr.clientWidth/2 - 40`: the knob travels from the middle to 40 dp short of each edge. */
export const SWIPE_EDGE_GAP = 40;
/** `setTimeout(()=>swipeCommit(id),160)`: the knob rests at the end for this long before the answer is sent. */
export const SWIPE_COMMIT_DELAY_MS = 160;
/** `Math.min(1,p*1.25)`: the knob reaches full red a fifth of the way before the end of the travel. */
export const SWIPE_DANGER_RATE = 1.25;
/** `rotate(${v/max*10}deg)`. */
export const SWIPE_ROTATE_DEG = 10;
/** The least movement that counts as a drag, in dp (the POC's `distance > 8`). */
export const SWIPE_MIN_DRAG_PX = 8;

/** The knob's travel for a track of this inner width (the width inside the border). */
export function swipeMax(trackWidth: number): number {
  "worklet";
  return Math.max(0, trackWidth / 2 - SWIPE_EDGE_GAP);
}

/** Milliseconds still to wait before the track arms, given when the screen opened. 0 once it is armed. */
export function swipeArmDelayLeft(openedAt: number, now: number): number {
  return Math.max(0, SWIPE_ARM_DELAY_MS - (now - openedAt));
}

/** The knob offset kept inside the travel. */
export function swipeClamp(dx: number, max: number): number {
  "worklet";
  return Math.max(-max, Math.min(max, dx));
}

/** `p = Math.min(1, Math.abs(v)/max)`: how far along the travel the knob is, 0 to 1. */
export function swipeProgress(dx: number, max: number): number {
  "worklet";
  return max > 0 ? Math.min(1, Math.abs(dx) / max) : 0;
}

/** The side a release at `dx` commits to, or null when it is inside the mark and the knob springs back. */
export function swipeSideAt(dx: number, max: number): SwipeSide | null {
  "worklet";
  if (max <= 0) return null;
  if (dx > max * SWIPE_COMMIT_FRACTION) return "right";
  if (dx < -max * SWIPE_COMMIT_FRACTION) return "left";
  return null;
}

/** The knob's tilt in degrees at offset `dx`. */
export function swipeRotation(dx: number, max: number): number {
  "worklet";
  return max > 0 ? (dx / max) * SWIPE_ROTATE_DEG : 0;
}

/** How far the knob has blended toward the danger red (0 to 1) when it is dragged toward a destructive side. */
export function swipeDangerBlend(dx: number, max: number): number {
  "worklet";
  return Math.min(1, swipeProgress(dx, max) * SWIPE_DANGER_RATE);
}

/**
 * The stale-touch guard for the live track. A touch whose first reading is already past the
 * mark is the tail of the tap or swipe that opened the screen, and must not send an answer.
 * (The same rule as `swipeCanBegin`, scaled to the track's travel instead of a fixed 68.)
 *
 * It does NOT ask for a minimum distance: the pan only activates after `SWIPE_MIN_DRAG_PX`, and
 * at activation the translation can still read near zero, so a minimum here rejected every real
 * drag (the knob would not move at all).
 */
export function swipeDragMayBegin(dx: number, dy: number, max: number): boolean {
  "worklet";
  const distance = Math.abs(dx);
  return max > 0 && distance < max * SWIPE_COMMIT_FRACTION && distance >= Math.abs(dy);
}
