/**
 * Need card, from the prototype's `.needcard` and its `.nmain`, `.nt1`, `.nq`
 * and `.nm`. The bot's wash is a radial gradient from the left edge. The
 * card's bottom edge is a 3 dp shadow, which goes to 1 dp when pressed.
 */
import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { Tag } from "./Pill";
import { useBotTheme, useTheme } from "./theme";
import { type ThemeBot } from "./botTheme";
import { fontFamily } from "./tokens";

export interface NeedCardProps {
  /** Which bot the card belongs to. Sets the wash colour. */
  bot: ThemeBot;
  /** Bot name, shown first in the top line. */
  name: string;
  /** The question, up to two lines. */
  question: string;
  /** Right side of the top line, such as "now" or "2 min". */
  time?: string;
  /** Optional tag, such as URGENT or PAIRING. */
  tag?: { label: string; urgent?: boolean };
  urgent?: boolean;
  /** Bottom line, such as "From MacBook". */
  meta?: string;
  /** Icon before `meta`. Give one whenever `metaWarn` is set. */
  metaIcon?: ReactNode;
  /** Shows the meta line in the warn tone (`.nm.warn`). */
  metaWarn?: boolean;
  /** The bot blob, or any leading visual, at 44 dp. */
  leading?: ReactNode;
  onPress: () => void;
  testID?: string;
}

/** `.needcard`: 20 radius, 1.5 dp border, 14 / 16 padding. */
export function NeedCard({
  bot,
  name,
  question,
  time,
  tag,
  urgent = false,
  meta,
  metaIcon,
  metaWarn = false,
  leading,
  onPress,
  testID,
}: NeedCardProps) {
  const t = useTheme().tokens;
  const { botWash } = useBotTheme(bot);
  const metaColour = metaWarn ? t.warn : t.ink3;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, question, meta].filter(Boolean).join(". ")}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: t.card,
          borderColor: urgent ? t.dangeredge : t.line,
          boxShadow: pressed ? `0px 1px 0px 0px ${t.edge}` : `0px 3px 0px 0px ${t.edge}`,
          transform: [{ translateY: pressed ? 2 : 0 }],
        },
      ]}
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="needWash" cx="0%" cy="50%" rx="70%" ry="130%" fx="0%" fy="50%">
            <Stop offset="0" stopColor={botWash} stopOpacity="1" />
            <Stop offset="0.65" stopColor={botWash} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#needWash)" />
      </Svg>

      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.topLine}>
          <Text style={[styles.name, { color: t.ink2 }]}>{name}</Text>
          {tag ? <Tag urgent={tag.urgent}>{tag.label}</Tag> : null}
          {time ? <Text style={[styles.time, { color: t.ink3 }]}>{time}</Text> : null}
        </View>
        <Text numberOfLines={2} style={[styles.question, { color: t.ink }]}>
          {question}
        </Text>
        {meta ? (
          <View style={styles.meta}>
            {metaIcon}
            <Text style={{ color: metaColour, fontFamily: fontFamily.bold, fontSize: 13.5 }}>{meta}</Text>
          </View>
        ) : null}
      </View>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d="M9 5l7 7-7 7"
          fill="none"
          stroke={t.ink3}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    width: "100%",
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontFamily: fontFamily.extraBold,
    fontSize: 14,
  },
  time: {
    marginLeft: "auto",
    fontFamily: fontFamily.bold,
    fontSize: 13,
  },
  question: {
    marginTop: 2,
    fontFamily: fontFamily.extraBold,
    fontSize: 16.5,
    lineHeight: 20.6,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
  },
});
