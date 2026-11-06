/**
 * One checkbox option on a multi-choice alert: the prototype's `.opt` as `check` builds it in the
 * `multi` branch of `alertBody`, with `.checked`, `.box`, `.rec`, `.rectag`, `.hasdesc` and
 * `.desc` (`vault/Projects/Puck/mockups/Puck prototype.html`).
 *
 * - Same face as `OptionButton`: 62 dp minimum height, radius 22, a 4 dp bottom edge that
 *   shrinks to 1 dp (and the row drops 3 dp) while pressed. Checking is free: one tap toggles,
 *   there is no arm and no timer.
 * - The 24 dp box sits on the right. Checked fills it with the bot colour, shows a white tick
 *   that springs in, borders the row in the bot colour and tints its face.
 * - `rec` adds the RECOMMENDED tag and a heavier neutral border, which also wins over the
 *   checked border (the prototype's `.opt.rec` rule comes after `.opt.checked`).
 * - `tone: "destructive"` keeps the red look (label, warning icon, border) and, checked, uses the
 *   danger fill. The prototype's multi branch never sets the tone; this follows the card.
 * - Meaning is never colour alone: the box shows a tick when checked, and the row is a checkbox
 *   for screen readers.
 *
 * Colours come from `useTheme()` and `useBotTheme()` only, apart from the night face colours and
 * the white tick, which the prototype hard-codes.
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import type { ThemeBot } from "./botTheme";
import { RichText } from "./RichText";
import { parseRichText } from "./richTextParse";
import { useBotTheme, useTheme } from "./theme";
import { fontFamily, radii } from "./tokens";

export interface CheckOptionProps {
  label: string;
  /** Description under the label; `**bold**`, `*italic*`, `__underline__` and `code` markup. */
  desc?: string;
  tone?: "destructive";
  /** Shows the RECOMMENDED tag. */
  rec?: boolean;
  bot: ThemeBot;
  checked: boolean;
  /** Dimmed and not pressable. */
  disabled?: boolean;
  /** Called on every tap; the screen owns the checked state. */
  onToggle: () => void;
  testID?: string;
}

const WARN_ICON =
  "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";
const TICK = "M5 12.5l4.5 4.5L19 7.5";

/** `.night .opt` face colours; the prototype keeps them outside the tokens. */
const NIGHT_FACE = "#1C1A18";
const NIGHT_LINE = "#2C2926";
/** `.opt .box svg{stroke:#fff}`. */
const TICK_COLOUR = "#fff";

const MIN_HEIGHT = 62;
const PRESS = 3;
const DISABLED_OPACITY = 0.32;
const SPRING = { damping: 14, stiffness: 200, mass: 1 } as const;
const MAX_FONT_SCALE = 1.3;

export function CheckOption({
  label,
  desc,
  tone,
  rec = false,
  bot,
  checked,
  disabled = false,
  onToggle,
  testID,
}: CheckOptionProps) {
  const { tokens: t, night } = useTheme();
  const bt = useBotTheme(bot);
  const reducedMotion = useReducedMotion();
  const destructive = tone === "destructive";
  const hasDesc = Boolean(desc);
  const [pressed, setPressed] = useState(false);

  // Face colours. `.opt`, then `.opt.destructive`, `.opt.checked`, and `.opt.rec` last.
  let background = night ? NIGHT_FACE : t.card;
  let borderColor = night ? NIGHT_LINE : t.line;
  if (destructive) borderColor = t.dangeredge;
  if (checked) {
    background = destructive ? t.dangerbg : bt.botTint;
    borderColor = destructive ? t.danger : bt.bot;
  }
  if (rec) borderColor = t.ink2;
  const borderWidth = rec ? 2 : 1.5;
  const labelColour = destructive ? t.danger : t.ink;
  const boxFill = destructive ? t.danger : bt.bot;

  const down = pressed && !disabled;
  const edgeHeight = down ? 1 : 4;
  const target = down ? PRESS : 0;

  const translateY = useSharedValue(0);
  useEffect(() => {
    translateY.value = reducedMotion ? target : withSpring(target, SPRING);
  }, [target, reducedMotion, translateY]);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  // `.opt .box svg`: opacity 0 and scale .4 unchecked, springing to 1 when checked.
  const tick = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    tick.value = reducedMotion ? (checked ? 1 : 0) : withSpring(checked ? 1 : 0, SPRING);
  }, [checked, reducedMotion, tick]);
  const tickStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, tick.value)),
    transform: [{ scale: 0.4 + 0.6 * tick.value }],
  }));

  const spoken = useMemo(() => {
    const plain = desc ? parseRichText(desc).map((s) => s.text).join("") : "";
    return [label, destructive ? "destructive" : null, rec ? "recommended" : null, plain || null]
      .filter(Boolean)
      .join(", ");
  }, [label, desc, destructive, rec]);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={spoken}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
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
            boxShadow: [{ offsetX: 0, offsetY: edgeHeight, blurRadius: 0, spreadDistance: 0, color: t.edge }],
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
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: labelColour }]}>
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
        <View
          accessible={false}
          style={[
            styles.box,
            checked
              ? { backgroundColor: boxFill, borderColor: boxFill }
              : { backgroundColor: "transparent", borderColor: t.edge },
          ]}
        >
          <Animated.View style={tickStyle}>
            <Svg width={14} height={14} viewBox="0 0 24 24" accessible={false}>
              <Path
                d={TICK}
                fill="none"
                stroke={TICK_COLOUR}
                strokeWidth={3.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        </View>
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
  box: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
