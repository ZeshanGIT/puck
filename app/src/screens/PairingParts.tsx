/**
 * Small pieces the pairing screens (B3, B4, B5) share, from the prototype's `.nav`, `.iconbtn`
 * and `.kv` CSS (`vault/Projects/Puck/mockups/Puck prototype.html`). Colours come from `useTheme()`.
 */
import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";

export const MAX_FONT_SCALE = 1.3;
const BACK = "M15 5l-7 7 7 7";

/** `.nav`: 56 dp high, the back button, and an optional `h2` (20 / 800). */
export function NavBar({ title, onBack }: { title?: string; onBack: () => void }) {
  const t = useTheme().tokens;
  return (
    <View style={styles.nav}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed ? { backgroundColor: t.fill } : null]}
      >
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Path d={BACK} fill="none" stroke={t.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Pressable>
      {title ? (
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: t.ink }]}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}

/** `.kv`: a label on the left (15 / 700, ink) and its value on the right (ink2). */
export function KvRow({ label, children, first = false }: { label: string; children: ReactNode; first?: boolean }) {
  const t = useTheme().tokens;
  return (
    <View style={[styles.kv, first ? null : { borderTopWidth: 1, borderTopColor: t.line }]}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kvLabel, { color: t.ink }]}>
        {label}
      </Text>
      <View style={styles.kvValue}>{children}</View>
    </View>
  );
}

/** The text of a `.kv` value. */
export function KvText({ children, mono = false }: { children: string; mono?: boolean }) {
  const t = useTheme().tokens;
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[styles.kvText, { color: t.ink2 }, mono ? styles.mono : null]}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 14, height: 56 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fontFamily.extraBold, fontSize: 20, fontWeight: "800", marginLeft: 4 },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  kvLabel: { fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700" },
  kvValue: { flexShrink: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  kvText: { fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  mono: { fontFamily: "monospace" },
});
