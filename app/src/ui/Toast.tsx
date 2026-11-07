/**
 * Toast, from the prototype's `.toast` and `toast()`: a dark pill 52 dp from
 * the top, fading in and out, hidden after 2.2 s when driven by `useToast`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { fontFamily } from "./tokens";

/**
 * `.toast` background `#1E1B19` with white text in the prototype, in both modes.
 * It is not a theme token, so it lives here as a constant.
 */
const TOAST_BG = "#1E1B19";
const TOAST_TEXT = "#FFFFFF";
const SPRING = { damping: 14, stiffness: 200, mass: 1 } as const;
const FADE_MS = 300;
export const TOAST_DURATION_MS = 2200;

export interface ToastProps {
  message: string;
  visible: boolean;
}

export function Toast({ message, visible }: ToastProps) {
  const reduceMotion = useReducedMotion();

  const style = useAnimatedStyle(() => {
    const opacity = visible ? withTiming(1, { duration: FADE_MS }) : withTiming(0, { duration: FADE_MS });
    const translateY = reduceMotion
      ? 0
      : visible
        ? withSpring(0, SPRING)
        : withSpring(-12, SPRING);
    return { opacity, transform: [{ translateY }] };
  }, [visible, reduceMotion]);

  return (
    <View pointerEvents="none" style={styles.layer}>
      <Animated.View
        accessibilityLiveRegion="polite"
        importantForAccessibility={visible ? "yes" : "no-hide-descendants"}
        style={[styles.pill, style]}
      >
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  );
}

/**
 * Shows a message for 2.2 s, like the prototype's `toast()`. Render the
 * result with `<Toast message={message} visible={visible} />` in the screen.
 * A new `show` call restarts the timer.
 */
export function useToast(durationMs: number = TOAST_DURATION_MS) {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (text: string) => {
      setMessage(text);
      setVisible(true);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => setVisible(false), durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return { show, message, visible };
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 52,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  pill: {
    maxWidth: "90%",
    backgroundColor: TOAST_BG,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  text: {
    color: TOAST_TEXT,
    fontFamily: fontFamily.extraBold,
    fontSize: 14.5,
  },
});
