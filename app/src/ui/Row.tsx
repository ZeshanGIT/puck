/**
 * List row, from the prototype's `.row`, `.gi`, `.val` and `.chev`, and the
 * two-line list items (`.t1`, `.t2`, `.t3`). Inside a `Group` it uses the
 * grouped padding. `leading` takes the bot blob or an icon. The caller
 * supplies it, so this file never imports the blob.
 */
import { type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text, useLines } from "./Text";
import Svg, { Path } from "react-native-svg";
import { Tag } from "./Pill";
import { useInGroup } from "./Group";
import { useTheme } from "./theme";
import { fontFamily } from "./tokens";

export type RowDetailTone = "neutral" | "ok" | "bad" | "warn";

export interface RowProps {
  title: string;
  /** `.t2`: one line, truncated with an ellipsis. */
  subtitle?: string;
  /** `.t1` time, right-aligned. */
  time?: string;
  /** Urgent or other tag beside the title. */
  tag?: { label: string; urgent?: boolean };
  /** `.t3`: a line of detail under the subtitle. Give `detailIcon` too, so the tone is not the only cue. */
  detail?: string;
  detailIcon?: ReactNode;
  detailTone?: RowDetailTone;
  /** `.val`: right-aligned value such as "Default" or "All good". */
  value?: string;
  /** Left slot: the bot blob, or a `.gi` icon tile. */
  leading?: ReactNode;
  /** Shows the 18 dp chevron (`.chev`). */
  chevron?: boolean;
  onPress?: () => void;
  testID?: string;
}

/** `.row`: 12 / 22 padding, or 14 / 16 inside a `Group`. */
export function Row({
  title,
  subtitle,
  time,
  tag,
  detail,
  detailIcon,
  detailTone = "neutral",
  value,
  leading,
  chevron = false,
  onPress,
  testID,
}: RowProps) {
  const t = useTheme().tokens;
  const inGroup = useInGroup();
  const subtitleLines = useLines(1);
  const detailColour = {
    neutral: t.ink2,
    ok: t.ok,
    bad: t.danger,
    warn: t.warn,
  }[detailTone];

  const content = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
            <Text style={{ color: t.ink, fontFamily: fontFamily.extraBold, fontSize: 15, flexShrink: 1 }}>
              {title}
            </Text>
            {tag ? <Tag urgent={tag.urgent}>{tag.label}</Tag> : null}
          </View>
          {time ? (
            <Text style={{ color: t.ink3, fontFamily: fontFamily.bold, fontSize: 13, flexShrink: 0 }}>
              {time}
            </Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text
            numberOfLines={subtitleLines}
            style={{ color: t.ink, fontFamily: fontFamily.semiBold, fontSize: 15, marginTop: 1 }}
          >
            {subtitle}
          </Text>
        ) : null}
        {detail ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            {detailIcon}
            <Text style={{ color: detailColour, fontFamily: fontFamily.bold, fontSize: 13.5 }}>
              {detail}
            </Text>
          </View>
        ) : null}
      </View>
      {value ? (
        <Text style={{ color: t.ink2, fontFamily: fontFamily.bold, fontSize: 14.5, flexShrink: 0 }}>
          {value}
        </Text>
      ) : null}
      {chevron ? <ChevronIcon colour={t.ink3} /> : null}
    </>
  );

  const padding = inGroup
    ? { paddingVertical: 14, paddingHorizontal: 16 }
    : { paddingVertical: 12, paddingHorizontal: 22 };
  const baseStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
    width: "100%" as const,
    ...padding,
  };

  if (!onPress) {
    return (
      <View style={baseStyle} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, detail].filter(Boolean).join(", ")}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [baseStyle, { backgroundColor: pressed && !inGroup ? t.fill : "transparent" }]}
    >
      {content}
    </Pressable>
  );
}

function ChevronIcon({ colour }: { colour: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M9 5l7 7-7 7"
        fill="none"
        stroke={colour}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
