/**
 * Small pieces the Settings screens (S1 to S7) share, from the prototype's `srow`, `.gi`, `.sect`,
 * `.cap` and `.val` (`vault/Projects/Puck/mockups/Puck prototype.html`). Colours come from
 * `useTheme()`. The nav bar and the `.kv` rows are `PairingParts`.
 */
import { type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text, useLines } from "../ui/Text";
import Svg, { Path } from "react-native-svg";
import { Glyph } from "../ui/AlertFrame";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { MAX_FONT_SCALE } from "./PairingParts";

/** The prototype's `ICON` paths for Settings (24 x 24 viewBox); circles and rects drawn as paths. */
export const SETTINGS_ICON = {
  user: "M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0",
  phone: "M8.5 2.5h7A2.5 2.5 0 0 1 18 5v14a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19V5a2.5 2.5 0 0 1 2.5-2.5z",
  laptop: "M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5zM2 19h20",
  sound: "M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  heart: "M3 12h4l2-5 4 10 2-5h6",
  info: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5h.01",
  logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 20a1.9 1.9 0 0 0 3.4 0",
  check: "M5 12.5l4.5 4.5L19 7.5",
  warn: "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  dash: "M8 12h8",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
} as const;

export type SettingsIconName = keyof typeof SETTINGS_ICON;

export type ValueTone = "neutral" | "ok" | "warn";

/** `.gi`: a 34 dp tile with the icon in it. */
export function IconTile({ icon }: { icon: SettingsIconName }) {
  const t = useTheme().tokens;
  return (
    <View style={[styles.tile, { backgroundColor: t.card }]}>
      <Glyph d={SETTINGS_ICON[icon]} size={18} colour={t.ink} width={2.1} />
    </View>
  );
}

/** `srow`: tile, a 16 / 800 label, an optional value and a chevron. Without `onPress` it is a plain row. */
export function SettingsRow({
  icon,
  label,
  value,
  tone = "neutral",
  chevron = true,
  onPress,
  testID,
}: {
  icon: SettingsIconName;
  label: string;
  value?: string;
  tone?: ValueTone;
  chevron?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const t = useTheme().tokens;
  const colour = tone === "ok" ? t.ok : tone === "warn" ? t.warn : t.ink2;
  const lines = useLines(1);
  const content = (
    <>
      <IconTile icon={icon} />
      <Text numberOfLines={lines} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: t.ink }]}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={lines} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.value, { color: colour }]}>
          {value}
        </Text>
      ) : null}
      {onPress && chevron ? (
        <Svg width={18} height={18} viewBox="0 0 24 24" accessible={false}>
          <Path d="M9 5l7 7-7 7" fill="none" stroke={t.ink3} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      testID={testID}
      style={styles.row}
    >
      {content}
    </Pressable>
  );
}

/** `.sect`: 12.5 / 900 caps, ink3. */
export function Section({ label }: { label: string }) {
  const t = useTheme().tokens;
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.section, { color: t.ink3 }]}>
      {label}
    </Text>
  );
}

/** `.cap`: 13.5 / 600, ink3. */
export function Caption({ children, testID }: { children: ReactNode; testID?: string }) {
  const t = useTheme().tokens;
  return (
    <Text testID={testID} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caption, { color: t.ink3 }]}>
      {children}
    </Text>
  );
}

/** An error line, under the controls it belongs to. */
export function ErrorLine({ message }: { message: string | null }) {
  const t = useTheme().tokens;
  if (!message) return null;
  return (
    <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: t.danger }]}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  tile: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  /** `.group .row`: 14 / 16 padding, 14 gap. */
  row: { flexDirection: "row", alignItems: "center", gap: 14, width: "100%", paddingVertical: 14, paddingHorizontal: 16 },
  label: { flex: 1, minWidth: 0, fontFamily: fontFamily.extraBold, fontSize: 16, fontWeight: "800" },
  value: { flexShrink: 1, fontFamily: fontFamily.bold, fontSize: 14.5, fontWeight: "700" },
  section: {
    fontFamily: fontFamily.black,
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 12.5 * 0.08,
    textTransform: "uppercase",
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 6,
  },
  caption: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13.5,
    lineHeight: 13.5 * 1.4,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  error: {
    fontFamily: fontFamily.extraBold,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    paddingTop: 14,
    paddingHorizontal: 22,
  },
});
