/**
 * B4 Approve bot: the security step. He sees exactly what is asking to page him: the bot in its
 * own colour, where it came from, the bot id it will get and its colour, and (for a request that
 * came to the phone by itself) the six-digit code to check against the terminal. Approve takes two
 * taps; Reject is one. Prototype: `SCREENS.approve` and `.bigcode`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` B4.
 *
 * `B4Approve` only draws: the host (`PairingHost`) approves and rejects. `showCode` is false when he
 * typed the code himself (B3), since matching a code he just typed proves nothing.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import {
  colourRow,
  expiryText,
  formatCode,
  fromText,
  requestLook,
  type PairingRequest,
} from "../pairingModel";
import { Wash } from "../ui/AlertFrame";
import { Blob, type BlobHandle } from "../ui/Blob";
import { PALETTE } from "../ui/botTheme";
import { Btn } from "../ui/Btn";
import { useBotTheme, useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { HeroText } from "../onboarding/parts";
import { KvRow, KvText, MAX_FONT_SCALE, NavBar } from "./PairingParts";

export interface B4ApproveProps {
  request: PairingRequest;
  /** Show the big code and "Check this matches your terminal" (a request that came by itself). */
  showCode: boolean;
  /** Now, so "Expires in 9 min" follows the clock. */
  now: number;
  /** Approving or rejecting is in flight: both buttons are still. */
  busy?: boolean;
  /** An error from the last try; null for none. */
  error?: string | null;
  /** The second tap of Approve. */
  onApprove: () => void;
  onReject: () => void;
  onBack: () => void;
}

export function B4Approve({ request, showCode, now, busy = false, error = null, onApprove, onReject, onBack }: B4ApproveProps) {
  const t = useTheme().tokens;
  const look = useMemo(() => requestLook(request), [request]);
  const bt = useBotTheme(look);
  const colour = colourRow(request);
  const swatch = PALETTE.find((entry) => entry.name === colour.name)?.base ?? bt.bot;
  const blob = useRef<BlobHandle>(null);
  // `blob(b,130,{live:true,cls:"arrive"})`: the blob arrives when the screen opens.
  useLayoutEffect(() => {
    blob.current?.arrive();
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <Wash colour={bt.botWash} night={false} />
      <View style={[styles.content, { paddingTop: (StatusBar.currentHeight ?? 24) + 8 }]}>
        <NavBar onBack={onBack} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <Blob ref={blob} bot={look} size={130} live />
            <HeroText title={`${request.name} wants to page you`} />
          </View>
          <View style={[styles.group, { backgroundColor: t.fill }]}>
            <KvRow label="From" first>
              <KvText>{fromText(request.addedFrom)}</KvText>
            </KvRow>
            <KvRow label="Bot ID">
              <KvText mono>{request.botId}</KvText>
            </KvRow>
            <KvRow label="Colour">
              <View style={[styles.dot, { backgroundColor: swatch }]} />
              <KvText>{colour.suggested ? `${colour.name} (suggested)` : colour.name}</KvText>
            </KvRow>
          </View>
          {showCode ? (
            <View style={styles.codeBlock} accessible accessibilityLabel={`Code ${request.pairingCode.split("").join(" ")}. Check this matches your terminal.`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.codeLabel, { color: t.ink3 }]}>
                Code
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.code, { color: t.ink }]}>
                {formatCode(request.pairingCode)}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.check, { color: t.ink2 }]}>
                Check this matches your terminal
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.expiry, { color: t.ink3 }]}>
                {expiryText(request.expiresAt, now)}
              </Text>
            </View>
          ) : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.expiry, styles.typed, { color: t.ink3 }]}>
              {expiryText(request.expiresAt, now)}
            </Text>
          )}
        </ScrollView>
        {error ? (
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: t.danger }]}>
            {error}
          </Text>
        ) : null}
        <View style={styles.bottom}>
          <Btn
            label={busy ? "Approving…" : "Approve"}
            variant="bot"
            bot={look}
            disabled={busy}
            tapTwice={{ onConfirm: onApprove, armedLabel: "Tap again to approve" }}
          />
          <Btn label="Reject" variant="ghost" disabled={busy} onPress={onReject} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 12 },
  hero: { alignItems: "center", paddingTop: 0 },
  /** `.group{margin-top:20px; background:var(--fill)}` (margin 4 16 0, radius 18). */
  group: { marginTop: 20, marginHorizontal: 16, borderRadius: 18, overflow: "hidden" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  /** The code block: `margin-top:20px`, centred. */
  codeBlock: { alignItems: "center", marginTop: 20, paddingHorizontal: 22 },
  codeLabel: {
    fontFamily: fontFamily.black,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 13 * 0.07,
    textTransform: "uppercase",
  },
  /** `.bigcode{font-size:38px; font-weight:900; letter-spacing:.08em; margin-top:4px}` */
  code: { fontFamily: fontFamily.black, fontSize: 38, fontWeight: "900", letterSpacing: 38 * 0.08, marginTop: 4 },
  check: { fontFamily: fontFamily.bold, fontSize: 14.5, fontWeight: "700", textAlign: "center" },
  expiry: { fontFamily: fontFamily.semiBold, fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 6 },
  typed: { marginTop: 20 },
  error: {
    fontFamily: fontFamily.extraBold,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  /** `padding:0 20px 6px` */
  bottom: { paddingHorizontal: 20, paddingBottom: 6, gap: 4 },
});
