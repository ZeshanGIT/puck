/**
 * An on/off switch drawn in the app's own style, not the phone's: a 52 x 32 pill that fills with
 * `ink` when on and sits in the quiet `fill2` with an `edge` rim when off, with a round `card`
 * thumb that slides across and gives a little under the finger. It states its state in words for
 * screen readers (`accessibilityRole="switch"`), and the position of the thumb, not only the
 * colour, shows which side it is on.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet } from "react-native";
import { useTheme } from "./theme";

const WIDTH = 52;
const HEIGHT = 32;
const BORDER = 1.5;
const PAD = 3;
const THUMB = HEIGHT - BORDER * 2 - PAD * 2;
/** How far the thumb slides: the room inside the rim, less the thumb and the gap kept on both sides. */
const TRAVEL = WIDTH - BORDER * 2 - THUMB - PAD * 2;

export interface ToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  /** Read out by screen readers, since the switch has no text of its own. */
  label: string;
  testID?: string;
}

export function Toggle({ value, onChange, label, testID }: ToggleProps) {
  const t = useTheme().tokens;
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  const press = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, position]);

  const squeeze = (to: number) =>
    Animated.timing(press, { toValue: to, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();

  const track = position.interpolate({ inputRange: [0, 1], outputRange: [t.fill2, t.ink] });
  const rim = position.interpolate({ inputRange: [0, 1], outputRange: [t.edge, t.ink] });
  const left = position.interpolate({ inputRange: [0, 1], outputRange: [PAD, PAD + TRAVEL] });
  const thumbWidth = press.interpolate({ inputRange: [0, 1], outputRange: [THUMB, THUMB + 4] });
  // The thumb grows to the right, so on the right side it also shifts left to stay inside the pill.
  const shift = Animated.multiply(position, press.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      onPressIn={() => squeeze(1)}
      onPressOut={() => squeeze(0)}
      hitSlop={8}
      testID={testID}
    >
      <Animated.View style={[styles.track, { backgroundColor: track, borderColor: rim }]}>
        <Animated.View
          style={[
            styles.thumb,
            { backgroundColor: t.card, left, width: thumbWidth, transform: [{ translateX: shift }] },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: WIDTH,
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    borderWidth: BORDER,
    justifyContent: "center",
  },
  thumb: {
    position: "absolute",
    top: PAD,
    height: THUMB,
    borderRadius: THUMB / 2,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 2.5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
