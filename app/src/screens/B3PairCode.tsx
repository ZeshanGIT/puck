/**
 * B3 Pair a bot: the fallback for a CLI that is not signed in, or a request he cannot find. He
 * types the six-digit code `puck add` shows on a keypad. Prototype: `SCREENS.pair` and the
 * `.digits`, `.pad` and `.err` CSS (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` B3.
 *
 * `B3PairCode` only draws and collects digits: the sixth one calls `onSubmit`, and the host
 * (`PairingHost`) decides what the code means (a waiting request goes to B4; otherwise it is approved
 * straight away). A key press calls `onEdit`, so the host can clear its error. The keypad logic is
 * `pairingModel.ts` (`pressKey`).
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import Svg, { Path } from "react-native-svg";
import { codeBoxes, cursorIndex, isComplete, PAD_LAYOUT, padCellKeys, pressKey, type PadKey } from "../pairingModel";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { OnboardingFrame } from "../onboarding/parts";
import { MAX_FONT_SCALE, NavBar } from "./PairingParts";

export interface B3PairCodeProps {
  /** An error to show under the boxes (wrong code, expired); null for none. */
  error: string | null;
  /** The host is working on the code: the keypad is still. */
  busy?: boolean;
  /** Six digits are in. */
  onSubmit: (code: string) => void;
  /** Any key press: the host clears its error. */
  onEdit?: () => void;
  onBack: () => void;
}

const BACKSPACE = "M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9.5l-5 5M12 9.5l5 5";

const CELL_KEYS = padCellKeys();

export function B3PairCode({ error, busy = false, onSubmit, onEdit, onBack }: B3PairCodeProps) {
  const t = useTheme().tokens;
  const [digits, setDigits] = useState("");
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    // Once per completed entry; deleting a digit and typing another is a new entry.
    if (!isComplete(digits)) {
      submitted.current = null;
      return;
    }
    if (submitted.current === digits) return;
    submitted.current = digits;
    onSubmit(digits);
  }, [digits, onSubmit]);

  const press = (key: PadKey) => {
    if (busy) return;
    onEdit?.();
    setDigits((before) => pressKey(before, key));
  };

  const boxes = codeBoxes(digits);
  const cursor = cursorIndex(digits);
  const box = (char: string, index: number) => (
    <View
      key={index}
      style={[
        styles.box,
        { backgroundColor: t.fill, borderColor: index === cursor ? t.ink : t.outline },
      ]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.boxText, { color: t.ink }]}>
        {char}
      </Text>
    </View>
  );

  return (
    <OnboardingFrame>
      <NavBar title="Pair a bot" onBack={onBack} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cap, { color: t.ink3 }]}>
        On the computer, run <Text style={{ color: t.ink, fontFamily: fontFamily.extraBold }}>puck add {"<name>"}</Text>, then
        type the code it shows.
      </Text>
      <View
        accessible
        accessibilityLabel={`Code, ${digits.length} of 6 digits entered`}
        style={styles.digits}
      >
        {boxes.left.map((char, i) => box(char, i))}
        <View style={styles.gap} />
        {boxes.right.map((char, i) => box(char, i + 3))}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.err, { color: busy ? t.ink3 : t.danger }]}
      >
        {busy ? "Pairing…" : (error ?? "")}
      </Text>
      <View style={styles.spacer} />
      <View style={styles.pad}>
        {[0, 3, 6, 9].map((start) => (
          <View key={start} style={styles.padRow}>
            {PAD_LAYOUT.slice(start, start + 3).map((key, i) =>
              key === null ? (
                <View key={CELL_KEYS[start + i]} style={styles.padCell} />
              ) : (
                <Pressable
                  key={CELL_KEYS[start + i]}
                  accessibilityRole="button"
                  accessibilityLabel={key === "back" ? "Delete" : key}
                  disabled={busy}
                  onPress={() => press(key)}
                  style={({ pressed }) => [
                    styles.padCell,
                    styles.padKey,
                    pressed ? { backgroundColor: t.fill } : null,
                  ]}
                >
                  {key === "back" ? (
                    <Svg width={26} height={26} viewBox="0 0 24 24">
                      <Path
                        d={BACKSPACE}
                        fill="none"
                        stroke={t.ink}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  ) : (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.padText, { color: t.ink }]}>
                      {key}
                    </Text>
                  )}
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>
      <View style={styles.bottom} />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  /** `.cap` at 15 px with no top padding, as B3 sets it. */
  cap: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    lineHeight: 15 * 1.4,
    paddingHorizontal: 22,
  },
  /** `.digits{gap:8px; margin:22px 0 6px}` */
  digits: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 22, marginBottom: 6 },
  /** `.digits i`: 44 x 56, radius 14, a 1.5 dp border. */
  box: { width: 44, height: 56, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  boxText: { fontFamily: fontFamily.black, fontSize: 26, fontWeight: "900" },
  gap: { width: 8 },
  /** `.err{min-height:20px}` */
  err: { textAlign: "center", fontFamily: fontFamily.extraBold, fontSize: 14, fontWeight: "800", minHeight: 20, paddingHorizontal: 22 },
  spacer: { flex: 1 },
  /** `.pad{gap:8px; padding:10px 30px 0}` */
  pad: { gap: 8, paddingTop: 10, paddingHorizontal: 30 },
  padRow: { flexDirection: "row", gap: 8 },
  padCell: { flex: 1, height: 58 },
  /** `.pad button{height:58px; border-radius:16px; font-size:24px; font-weight:800}` */
  padKey: { borderRadius: 16, alignItems: "center", justifyContent: "center" },
  padText: { fontFamily: fontFamily.extraBold, fontSize: 24, fontWeight: "800" },
  bottom: { height: 24 },
});
