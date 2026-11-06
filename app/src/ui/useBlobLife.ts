/**
 * The blob's life loop (prototype `lifeTick()` and `look()`): glancing, blinking
 * and focus. Runs only for live blobs. Everything animates through shared values
 * on the UI thread; the hook never re-renders React.
 */
import { useEffect, useRef } from "react";
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  BLINK_MS,
  BLINK_SCALE_Y,
  CURVES,
  EYE_MOVE_MS,
  LIFE_TICK_MS,
  lifeTick,
  type Offset,
} from "./blobShapes";

export { lifeTick, glanceValue } from "./blobShapes";

const spring = Easing.bezier(...CURVES.spring);
const easeInOut = Easing.bezier(...CURVES.easeInOut);

export interface BlobLife {
  /** Eye group offset in viewBox units. */
  eyeX: SharedValue<number>;
  eyeY: SharedValue<number>;
  /** Eye scale on Y (1 open, 0.12 at the middle of a blink). */
  eyeScaleY: SharedValue<number>;
}

/**
 * `.blob .eyes{transition:transform .38s var(--spring)}`: a timed move on the
 * prototype's spring curve. Reduced motion jumps straight there (the prototype
 * sets every transition to .01ms).
 */
function moveEyes(sv: SharedValue<number>, to: number, reduced: boolean) {
  sv.value = reduced
    ? to
    : withTiming(to, { duration: EYE_MOVE_MS, easing: spring, reduceMotion: ReduceMotion.Never });
}

/**
 * @param live run the glance and blink loop (alert screens only).
 * @param look focus point for the eyes in viewBox units; while set, the blob
 *   neither glances nor blinks (prototype `.focus`). When it clears, the eyes stay
 *   where they were until the next glance, as in the prototype's `unlook()`.
 */
export function useBlobLife(live: boolean, look: Offset | null | undefined): BlobLife {
  const reduced = useReducedMotion();
  const eyeX = useSharedValue(0);
  const eyeY = useSharedValue(0);
  const eyeScaleY = useSharedValue(1);
  const focused = useRef(false);
  focused.current = look != null;

  const lookX = look?.x;
  const lookY = look?.y;
  useEffect(() => {
    if (lookX == null || lookY == null) return;
    moveEyes(eyeX, lookX, reduced);
    moveEyes(eyeY, lookY, reduced);
  }, [lookX, lookY, reduced, eyeX, eyeY]);

  useEffect(() => {
    if (!live || reduced) return;
    const id = setInterval(() => {
      const { glance, blink } = lifeTick(focused.current);
      if (glance) {
        moveEyes(eyeX, glance.x, false);
        moveEyes(eyeY, glance.y, false);
      }
      if (blink) {
        // Restart from open, as the prototype's remove/re-add of `.blink` does.
        const half = { duration: BLINK_MS / 2, easing: easeInOut, reduceMotion: ReduceMotion.Never };
        eyeScaleY.value = withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(BLINK_SCALE_Y, half),
          withTiming(1, half),
        );
      }
    }, LIFE_TICK_MS);
    return () => {
      clearInterval(id);
      cancelAnimation(eyeScaleY);
      eyeScaleY.value = 1;
    };
  }, [live, reduced, eyeX, eyeY, eyeScaleY]);

  useEffect(
    () => () => {
      cancelAnimation(eyeX);
      cancelAnimation(eyeY);
      cancelAnimation(eyeScaleY);
    },
    [eyeX, eyeY, eyeScaleY],
  );

  return { eyeX, eyeY, eyeScaleY };
}
