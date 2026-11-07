/**
 * Bottom sheet, from the prototype's `.sheet`, `.scrim`, `.grab`, `.sopt`
 * and `openSheet()`. Radius 28, spring slide-up, 38% black scrim that closes
 * the sheet on tap. With reduced motion on it fades instead of sliding.
 */
import { type ReactNode, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "./theme";
import { fontFamily } from "./tokens";

/** `.scrim`: rgba(10,9,8,.38). Same in both modes in the prototype. */
const SCRIM_COLOUR = "rgba(10, 9, 8, 0.38)";
const SPRING = { damping: 14, stiffness: 200, mass: 1 } as const;
const FADE_IN_MS = 200;
const CLOSE_MS = 250;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

/**
 * Renders in a transparent Modal, so Android's back button also reaches
 * `onClose`. Keeps itself mounted until the close animation has finished.
 */
export function Sheet({ visible, onClose, children, testID }: SheetProps) {
  const t = useTheme().tokens;
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const height = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = reduceMotion
        ? withTiming(1, { duration: FADE_IN_MS })
        : withSpring(1, SPRING);
    } else if (mounted) {
      progress.value = withTiming(0, { duration: CLOSE_MS }, (finished) => {
        if (finished) {
          runOnJS(setMounted)(false);
        }
      });
    }
  }, [visible, reduceMotion]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const sheetStyle = useAnimatedStyle(() => {
    const travel = height.value > 0 ? height.value * 1.05 : 1000;
    return {
      opacity: reduceMotion ? progress.value : 1,
      transform: [
        {
          translateY: reduceMotion ? 0 : interpolate(progress.value, [0, 1], [travel, 0]),
        },
      ],
    };
  });

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill} testID={testID}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM_COLOUR }, scrimStyle]} />
        </Pressable>
        <Animated.View
          accessibilityViewIsModal
          onLayout={(e) => {
            height.value = e.nativeEvent.layout.height;
          }}
          style={[styles.sheet, { backgroundColor: t.card }, sheetStyle]}
        >
          <View style={[styles.grab, { backgroundColor: t.edge }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** `.sheet h3`: 21 / 900, 4 dp below. */
export function SheetTitle({ children }: { children: ReactNode }) {
  const t = useTheme().tokens;
  return (
    <Text
      accessibilityRole="header"
      style={[styles.title, { color: t.ink }]}
    >
      {children}
    </Text>
  );
}

/** `.sheet .sp`: 15 / 600, ink2, 16 dp below. */
export function SheetText({ children }: { children: ReactNode }) {
  const t = useTheme().tokens;
  return <Text style={[styles.text, { color: t.ink2 }]}>{children}</Text>;
}

export interface SheetOptionProps {
  label: string;
  icon?: ReactNode;
  /** Right-aligned hint, such as "No reminder". */
  detail?: string;
  onPress: () => void;
  testID?: string;
}

/** `.sopt`: 60 dp option, 18 radius, fill background, 10 dp below. */
export function SheetOption({ label, icon, detail, onPress, testID }: SheetOptionProps) {
  const t = useTheme().tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: pressed ? t.fill2 : t.fill },
      ]}
    >
      {icon}
      <Text style={[styles.optionLabel, { color: t.ink }]}>{label}</Text>
      {detail ? <Text style={[styles.optionDetail, { color: t.ink3 }]}>{detail}</Text> : null}
    </Pressable>
  );
}

/** Stroke icon used by sheet options, 20 dp, stroke ink2 by default. */
export function SheetOptionIcon({ d, colour }: { d: string; colour?: string }) {
  const t = useTheme().tokens;
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d={d}
        fill="none"
        stroke={colour ?? t.ink2}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = {
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 26,
    boxShadow: "0px -10px 40px rgba(0, 0, 0, 0.12)",
  } satisfies ViewStyle,
  grab: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
  } satisfies ViewStyle,
  title: {
    fontFamily: fontFamily.black,
    fontSize: 21,
    marginBottom: 4,
  },
  text: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 16,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    width: "100%",
    minHeight: 60,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 18,
    marginBottom: 10,
  } satisfies ViewStyle,
  optionLabel: {
    fontFamily: fontFamily.extraBold,
    fontSize: 17,
  },
  optionDetail: {
    marginLeft: "auto",
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
  },
};
