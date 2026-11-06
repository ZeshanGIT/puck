/**
 * One answer option on an alert: the prototype's `.opt`, `.armed`, `.rec`, `.rectag`,
 * `.hasdesc`, `.desc`, `.destructive` and `.sub` (`vault/Projects/Puck/mockups/Puck prototype.html`).
 *
 * - 62 dp minimum height, radius 22, a 4 dp bottom edge (`edge` at rest). Armed lifts it 3 dp,
 *   draws the edge 5 dp in the bot's deep colour, tints the face and drains the `ArmTimer` bar.
 * - Tap twice: it arms itself with `useTapTwice`. Put the options of one alert in one
 *   `TapTwiceGroup` so arming one disarms the others. `immediate` skips the arming (an FYI alert:
 *   one option, one tap).
 * - `rec` adds the RECOMMENDED tag and a heavier neutral border; it is never shown by colour alone.
 * - `tone: "destructive"` uses the danger colours and a warning icon.
 * - `onArmedChange` tells the screen when this option arms or disarms (the blob looks at it).
 *
 * Colours come from `useTheme()` and `useBotTheme()` only, apart from the night face colours,
 * which the prototype hard-codes (`.night .opt`).
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { ArmTimer } from "./ArmTimer";
import type { ThemeBot } from "./botTheme";
import { RichText } from "./RichText";
import { parseRichText } from "./richTextParse";
import { useBotTheme, useTheme } from "./theme";
import { fontFamily, radii } from "./tokens";
import { haptics, useTapTwice } from "./useTapTwice";

export interface OptionButtonProps {
  label: string;
  /** Description under the label; `**bold**`, `*italic*`, `__underline__` and `code` markup. */
  desc?: string;
  tone?: "destructive";
  /** Shows the RECOMMENDED tag. */
  rec?: boolean;
  bot: ThemeBot;
  /** The small text that fades in on the right while armed ("Tap again"). */
  armedHint?: string;
  /** Answers on the first tap, with no arming. */
  immediate?: boolean;
  /** Dimmed and not pressable. */
  disabled?: boolean;
  /** Not pressable, with no visual change (the stale-touch guard just after the screen opens). */
  inert?: boolean;
  /** The confirming tap (the second, or the only one when `immediate`). */
  onConfirm: () => void;
  onArmedChange?: (armed: boolean) => void;
  testID?: string;
}

const WARN_ICON =
  "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";

/** `.night .opt` face colours; the prototype keeps them outside the tokens. */
const NIGHT_FACE = "#1C1A18";
const NIGHT_LINE = "#2C2926";

const MIN_HEIGHT = 62;
const LIFT = 3;
const DISABLED_OPACITY = 0.32;
const SPRING = { damping: 14, stiffness: 200, mass: 1 } as const;
const MAX_FONT_SCALE = 1.3;

export function OptionButton({
  label,
  desc,
  tone,
  rec = false,
  bot,
  armedHint,
  immediate = false,
  disabled = false,
  inert = false,
  onConfirm,
  onArmedChange,
  testID,
}: OptionButtonProps) {
  const { tokens: t, dark, night } = useTheme();
  const bt = useBotTheme(bot);
  const reducedMotion = useReducedMotion();
  const destructive = tone === "destructive";
  const hasDesc = Boolean(desc);

  const twice = useTapTwice({ onConfirm });
  const armed = twice.armed;
  const { disarm } = twice;
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (disabled && armed) disarm();
  }, [disabled, armed, disarm]);

  useEffect(() => {
    onArmedChange?.(armed);
    // Report only changes of `armed`, not a new callback identity each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  function onPress() {
    if (disabled || inert) return;
    if (immediate) {
      haptics.confirm();
      onConfirm();
    } else {
      twice.press();
    }
  }

  // Face colours. Armed rules in the prototype: `.opt.armed`, then `.opt.destructive.armed`,
  // then `.opt.rec.armed` (which sets only the border and comes last).
  let background = night ? NIGHT_FACE : t.card;
  let borderColor = night ? NIGHT_LINE : t.line;
  let edge = t.edge;
  if (destructive) borderColor = t.dangeredge;
  if (rec) borderColor = t.ink2;
  if (armed) {
    background = destructive ? t.dangerbg : bt.botTint;
    borderColor = rec ? bt.bot : destructive ? t.danger : bt.bot;
    edge = destructive ? t.danger : bt.botDeep;
  }
  const borderWidth = rec ? 2 : 1.5;
  const labelColour = destructive ? t.danger : t.ink;
  const hintColour = destructive ? t.danger : dark ? bt.botLight : bt.botDeep;
  const barColour = destructive ? t.danger : dark ? bt.botLight : bt.bot;

  // `.opt:active` presses down 3 dp and shrinks the edge to 1 dp; armed presses to 2 dp.
  const down = pressed && !disabled && !inert;
  const edgeHeight = down ? 1 : armed ? 5 : 4;
  const target = down ? (armed ? -LIFT + 5 : LIFT) : armed ? -LIFT : 0;

  const translateY = useSharedValue(0);
  useEffect(() => {
    translateY.value = reducedMotion ? target : withSpring(target, SPRING);
  }, [target, reducedMotion, translateY]);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const hintProgress = useSharedValue(0);
  useEffect(() => {
    hintProgress.value = reducedMotion ? (armed ? 1 : 0) : withTiming(armed ? 1 : 0, { duration: 200 });
  }, [armed, reducedMotion, hintProgress]);
  const hintStyle = useAnimatedStyle(() => ({
    opacity: hintProgress.value,
    transform: [{ translateX: (1 - hintProgress.value) * 6 }],
  }));

  const spoken = useMemo(() => {
    const plain = desc ? parseRichText(desc).map((s) => s.text).join("") : "";
    return [label, destructive ? "destructive" : null, rec ? "recommended" : null, plain || null]
      .filter(Boolean)
      .join(", ");
  }, [label, desc, destructive, rec]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={armed ? "Tap again to confirm" : immediate ? undefined : "Tap twice to answer"}
      accessibilityState={{ disabled, selected: armed }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      testID={testID}
      style={[styles.outer, disabled ? styles.disabled : null]}
    >
      <Animated.View
        style={[
          styles.face,
          hasDesc ? styles.faceWithDesc : styles.faceBare,
          {
            backgroundColor: background,
            borderColor,
            borderWidth,
            boxShadow: [{ offsetX: 0, offsetY: edgeHeight, blurRadius: 0, spreadDistance: 0, color: edge }],
          },
          moved,
        ]}
      >
        {destructive ? (
          <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
            <Path
              d={WARN_ICON}
              fill="none"
              stroke={t.danger}
              strokeWidth={2.3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
        <View style={styles.lbl}>
          <View style={styles.lt}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.label, { color: labelColour }]}
            >
              {label}
            </Text>
            {rec ? (
              <View style={[styles.recTag, { backgroundColor: t.ink }]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recTagText, { color: t.bg }]}>
                  Recommended
                </Text>
              </View>
            ) : null}
          </View>
          {desc ? (
            <RichText
              text={desc}
              style={{
                fontFamily: fontFamily.semiBold,
                fontSize: 14,
                fontWeight: "600",
                lineHeight: 14 * 1.38,
                color: t.ink2,
                marginTop: 3,
              }}
            />
          ) : null}
        </View>
        {armedHint ? (
          <Animated.Text
            accessible={false}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.hint, { color: hintColour }, hintStyle]}
          >
            {armedHint}
          </Animated.Text>
        ) : null}
        {armed ? <ArmTimer color={barColour} armedAt={twice.armedAt} bottom={7} inset={20} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { alignSelf: "stretch" },
  disabled: { opacity: DISABLED_OPACITY },
  face: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: MIN_HEIGHT,
    borderRadius: radii.option,
  },
  faceBare: { paddingHorizontal: 20 },
  faceWithDesc: { paddingLeft: 18, paddingRight: 18, paddingTop: 13, paddingBottom: 14 },
  lbl: { flex: 1, minWidth: 0 },
  lt: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 8, rowGap: 4 },
  label: { fontFamily: fontFamily.extraBold, fontSize: 18, fontWeight: "800", flexShrink: 1 },
  recTag: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    justifyContent: "center",
  },
  recTagText: {
    fontFamily: fontFamily.black,
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 10.5 * 0.06,
    textTransform: "uppercase",
  },
  hint: { fontFamily: fontFamily.extraBold, fontSize: 13, fontWeight: "800" },
});
