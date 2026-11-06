/**
 * The bar under a tap-twice control (prototype `.armbar`): 3 dp tall, 7 dp from
 * the bottom of its parent, inset 20 dp, draining left to right over `ARM_MS`.
 * The parent must be a positioned view (every RN view is). Mount it only while
 * the control is armed; the owner (`useTapTwice`) does the disarming.
 *
 * Static (a full bar at 60% opacity, as the prototype's reduced-motion rule) when
 * the system reduced-motion setting is on, or when `frozen` is set.
 */
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ARM_MS } from "./useTapTwice";

export interface ArmTimerProps {
  /** Bar colour; the owner picks it per variant. */
  color: string;
  /**
   * When the control was armed (`Date.now()`); the bar starts with the time left.
   * Omit to start a full drain on mount.
   */
  armedAt?: number | null;
  /** Drain duration in ms. */
  ms?: number;
  /** Distance from the bottom edge of the parent, in dp. */
  bottom?: number;
  /** Left and right inset, in dp. */
  inset?: number;
  height?: number;
  /** Show a full, still bar regardless of the motion setting. */
  frozen?: boolean;
}

export function ArmTimer({
  color,
  armedAt = null,
  ms = ARM_MS,
  bottom = 7,
  inset = 20,
  height = 3,
  frozen = false,
}: ArmTimerProps) {
  const reducedMotion = useReducedMotion();
  const still = reducedMotion || frozen;
  const scale = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(scale);
    if (still) {
      scale.value = 1;
      return;
    }
    const left = armedAt == null ? ms : Math.max(0, ms - (Date.now() - armedAt));
    scale.value = left / ms;
    scale.value = withTiming(0, { duration: left, easing: Easing.linear });
    return () => cancelAnimation(scale);
  }, [armedAt, ms, still, scale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no"
      style={[
        styles.bar,
        { left: inset, right: inset, bottom, height, borderRadius: 2, backgroundColor: color },
        animated,
        still ? styles.still : null,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    transformOrigin: "left center",
    pointerEvents: "none",
  },
  still: { opacity: 0.6 },
});
