/**
 * `.btn` from the prototype (`vault/Projects/Puck/mockups/Puck prototype.html`)
 * in five variants: primary, bot, line, danger and ghost. A button either takes
 * a controlled `armed` state, or a `tapTwice` prop that wires `useTapTwice` and
 * the `ArmTimer` bar itself.
 *
 * Colours come from `useTheme()` and `useBotTheme(bot)` only.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "./Text";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { ArmTimer } from "./ArmTimer";
import type { ThemeBot } from "./botTheme";
import { useBotTheme, useTheme } from "./theme";
import { fontFamily } from "./tokens";
import { useTapTwice } from "./useTapTwice";

export type BtnVariant = "primary" | "bot" | "line" | "danger" | "ghost";

export interface BtnTapTwice {
  /** Called on the second tap within the arm window. */
  onConfirm: () => void;
  /** Label shown while armed, such as "Tap again to send 2". Defaults to `label`. */
  armedLabel?: string;
}

export interface BtnProps {
  label: string;
  variant?: BtnVariant;
  /** Plain press. Ignored when `tapTwice` is set. */
  onPress?: () => void;
  /** The bot whose colour the `bot` variant uses. Defaults to black. */
  bot?: ThemeBot;
  disabled?: boolean;
  /** Controlled armed look (and the timer bar). Ignored when `tapTwice` is set. */
  armed?: boolean;
  /** When the armed state began (`Date.now()`). Omit for a still, full bar. */
  armedAt?: number | null;
  /** Label shown while armed. Defaults to `label`. */
  armedLabel?: string;
  /** Makes this a tap-twice button that manages its own armed state. */
  tapTwice?: BtnTapTwice;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const DEFAULT_BOT: ThemeBot = { colour: "black" };

/** `color-mix(in srgb, <colour> <a*100>%, transparent)` for the hex colours the tokens use. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const RADIUS = 20;
const LIFT = 3;
const PRESS = 3;
const DANGER_ARMED_EDGE = "#7a1712";
const ARMED_BAR_ALPHA = 0.72;
const DISABLED_OPACITY = 0.32;
const SPRING = { damping: 14, stiffness: 200, mass: 1 } as const;

interface Look {
  background: string;
  color: string;
  borderColor?: string;
  /** Colour of the hard bottom edge, or null for none. */
  edge: string | null;
  /** Edge height at rest, and when armed, in dp. */
  edgeRest: number;
  edgeArmed: number;
  /** Armed lifts the button by 3 dp. */
  lifts: boolean;
  height: number;
  barColor: string;
}

function BtnFace({
  label,
  variant = "primary",
  onPress,
  bot = DEFAULT_BOT,
  disabled = false,
  armed = false,
  armedAt = null,
  armedLabel,
  twice = false,
  style,
  testID,
}: Omit<BtnProps, "tapTwice"> & { twice?: boolean }) {
  const { tokens: t, dark } = useTheme();
  const bt = useBotTheme(bot);
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);

  let look: Look;
  switch (variant) {
    case "bot":
      look = {
        // The prototype's --bot (equal to botTheme's sendBg, which lifts black in dark mode).
        background: bt.sendBg,
        color: bt.onBot,
        edge: bt.botDeep,
        edgeRest: 5,
        edgeArmed: 8,
        lifts: true,
        height: 58,
        barColor: withAlpha(bt.onBot, ARMED_BAR_ALPHA),
      };
      break;
    case "line":
      look = {
        background: t.card,
        color: t.ink,
        borderColor: t.line,
        edge: t.edge,
        edgeRest: 4,
        edgeArmed: 4,
        lifts: false,
        height: 58,
        barColor: t.ink,
      };
      break;
    case "danger": {
      // White on the light danger red is 6.5:1; on the dark theme's softer red it is 2.5:1, so the
      // dark theme's own background colour is the label (7.5:1).
      const armedLabel = dark ? t.bg : "#fff";
      look = armed
        ? {
            background: t.danger,
            color: armedLabel,
            edge: DANGER_ARMED_EDGE,
            edgeRest: 6,
            edgeArmed: 6,
            lifts: true,
            height: 58,
            barColor: withAlpha(armedLabel, ARMED_BAR_ALPHA),
          }
        : {
            background: t.dangerbg,
            color: t.danger,
            edge: t.dangeredge,
            edgeRest: 4,
            edgeArmed: 4,
            lifts: true,
            height: 58,
            barColor: withAlpha("#fff", ARMED_BAR_ALPHA),
          };
      break;
    }
    case "ghost":
      look = {
        background: "transparent",
        color: t.ink2,
        edge: null,
        edgeRest: 0,
        edgeArmed: 0,
        lifts: false,
        height: 48,
        barColor: t.ink2,
      };
      break;
    default:
      look = {
        background: t.primary,
        color: t.onprimary,
        edge: "rgba(0, 0, 0, 0.25)",
        edgeRest: 4,
        edgeArmed: 4,
        lifts: false,
        height: 58,
        barColor: withAlpha(t.onprimary, ARMED_BAR_ALPHA),
      };
  }

  const lifted = armed && look.lifts;
  // `.btn:active` presses the button down 3 dp and shrinks its edge to 1 dp; an
  // armed lifting variant stays up (its own rule wins over :active in the CSS).
  const down = pressed && !lifted && !disabled;
  const edgeHeight = lifted ? look.edgeArmed : down ? 1 : look.edgeRest;

  const translateTarget = lifted ? -LIFT : down ? PRESS : 0;
  const translateY = useSharedValue(0);
  useEffect(() => {
    translateY.value = reducedMotion ? translateTarget : withSpring(translateTarget, SPRING);
  }, [translateTarget, reducedMotion, translateY]);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const shownLabel = armed && armedLabel ? armedLabel : label;
  const hint = armed ? "Tap again to confirm" : twice ? "Activate twice to confirm" : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shownLabel}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      accessibilityLiveRegion={armed ? "polite" : "none"}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      testID={testID}
      style={[styles.outer, disabled ? styles.disabled : null, style]}
    >
      <Animated.View
        style={[
          styles.face,
          {
            minHeight: look.height,
            backgroundColor: look.background,
            borderColor: look.borderColor,
            borderWidth: look.borderColor ? 1.5 : 0,
            boxShadow: look.edge
              ? [{ offsetX: 0, offsetY: edgeHeight, blurRadius: 0, spreadDistance: 0, color: look.edge }]
              : undefined,
          },
          moved,
        ]}
      >
        <Text
          maxFontSizeMultiplier={1.3}
          style={[styles.label, { color: look.color }]}
        >
          {shownLabel}
        </Text>
        {armed ? (
          <ArmTimer
            color={look.barColor}
            armedAt={armedAt}
            frozen={armedAt == null}
            bottom={8}
            inset={24}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

function TapTwiceBtn({ tapTwice, ...rest }: BtnProps & { tapTwice: BtnTapTwice }) {
  const twice = useTapTwice({ onConfirm: tapTwice.onConfirm });
  const { disarm } = twice;
  useEffect(() => {
    if (rest.disabled && twice.armed) disarm();
  }, [rest.disabled, twice.armed, disarm]);
  return (
    <BtnFace
      {...rest}
      twice
      armed={twice.armed}
      armedAt={twice.armedAt}
      armedLabel={tapTwice.armedLabel ?? rest.armedLabel}
      onPress={twice.press}
    />
  );
}

export function Btn(props: BtnProps) {
  return props.tapTwice ? (
    <TapTwiceBtn {...props} tapTwice={props.tapTwice} />
  ) : (
    <BtnFace {...props} />
  );
}

const styles = StyleSheet.create({
  outer: { alignSelf: "stretch" },
  disabled: { opacity: DISABLED_OPACITY },
  face: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: RADIUS,
    // minHeight, not height: a long label wraps and the button grows (font scale up to 130%).
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  label: {
    flexShrink: 1,
    textAlign: "center",
    fontFamily: fontFamily.black,
    fontSize: 17,
    fontWeight: "900",
  },
});
