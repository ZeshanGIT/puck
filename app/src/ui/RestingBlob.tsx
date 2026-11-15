/**
 * The Puck blob asleep, for the all-quiet Home: closed eyes and a slow breath (the body swells and
 * settles over a few seconds). With reduced motion on, it just sits. Still, no glancing or blinking:
 * nothing here asks for attention.
 */
import { useEffect } from "react";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Blob } from "./Blob";
import { PUCK_HOME_BLOB } from "./puckBrandBlob";

/** One slow breath in or out. */
const BREATH_MS = 2600;
/** How far the body swells: a few percent, so it reads as breathing and not as bouncing. */
const SWELL = 1.035;

export function RestingBlob({ size = 132 }: { size?: number }) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      breath.value = 1;
      return;
    }
    const ease = Easing.inOut(Easing.sin);
    breath.value = withRepeat(
      withSequence(
        withTiming(SWELL, { duration: BREATH_MS, easing: ease, reduceMotion: ReduceMotion.Never }),
        withTiming(1, { duration: BREATH_MS, easing: ease, reduceMotion: ReduceMotion.Never }),
      ),
      -1,
      false,
    );
  }, [reduced, breath]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: breath.value }, { scaleX: 2 - breath.value }],
  }));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size, transformOrigin: "50% 100%" }, style]}
    >
      <Blob bot={PUCK_HOME_BLOB} size={size} still asleep />
    </Animated.View>
  );
}
