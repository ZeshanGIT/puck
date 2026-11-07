/**
 * A7 Sent receipt: after an answer, "You answered ...", then Sent, then "Delivered to <bot>", then
 * back to where he was. Prototype: `receiptHTML` and `.receipt`, `.rstat`, `.rnext`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` A7 and A10.
 *
 * Drop it into `AlertFrame`'s `bottom` slot, as the inline `Receipt` in A1 is today. It draws its
 * own 52 dp gap under the card. It is driven by `state`:
 * - `sending`: spinner and "Sending…" while the answer goes to Puck;
 * - `sent`: "Sent" (Puck has it); `delivered`: "Delivered to <bot>", green;
 * - `failed`: "Couldn't reach <bot>. Puck will keep trying." (a try failed; Puck retries);
 * - `queued`: "Waiting for network. It'll send by itself." (A10, no network).
 * It calls `onDone` once, about 1.5 s after `delivered` (4 s after `failed` or `queued`, which have
 * nothing more to wait for), or on a tap. The host uses `onDone` to go back to where he was.
 *
 * `useAnswerReceipt` reads the answer's delivery from Convex (`answers.receipt`) and combines it
 * with the local facts into a `state`. It needs the Convex provider; the dev sample route has none
 * and should pass a fixed `state` instead.
 */
import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import type { ReceiptState } from "@puck/shared";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import Svg, { Path } from "react-native-svg";
import { Spinner } from "../onboarding/parts";
import {
  answerSummary,
  attachmentSummary,
  receiptCloseDelayMs,
  receiptLine,
  receiptViewState,
  type ReceiptViewState,
} from "../receiptCopy";
import { Glyph, ICON } from "../ui/AlertFrame";
import type { BlobBot } from "../ui/blobShapes";
import { useTheme } from "../ui/theme";
import { fontFamily, radii } from "../ui/tokens";

const MAX_FONT_SCALE = 1.3;

export interface A7ReceiptProps {
  /** The bot that asked. Accepted for the API's sake; the receipt itself has no bot colour. */
  bot: BlobBot;
  /** Labels of the options he chose; empty for a reply made only of words or files. */
  answerLabels: string[];
  /** His own words, when he replied (A5). */
  reply?: string;
  /** Files he attached; shown as "+ a photo, report.pdf". */
  attachments?: { type: "photo" | "file"; name: string }[];
  state: ReceiptViewState;
  botName: string;
  /** Called once when the receipt closes itself or is tapped. */
  onDone: () => void;
}

/** `ICON.warn` of the prototype (24 x 24). */
const WARN_PATH =
  "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";

export function A7Receipt({ answerLabels, reply, attachments, state, botName, onDone }: A7ReceiptProps) {
  const t = useTheme().tokens;
  const line = receiptLine(state, botName);
  const summary = answerSummary(answerLabels);
  const files = attachmentSummary(attachments);
  const done = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const close = useCallback(() => {
    if (done.current) return;
    done.current = true;
    doneRef.current();
  }, []);

  useEffect(() => {
    const delay = receiptCloseDelayMs(state);
    if (delay === null) return;
    const id = setTimeout(close, delay);
    return () => clearTimeout(id);
  }, [state, close]);

  const colour = line.tone === "ok" ? t.ok : line.tone === "warn" ? t.warn : t.ink2;
  const spoken = [
    "You answered",
    summary,
    reply ? `“${reply}”` : null,
    files,
    line.text,
    "Tap to close",
  ]
    .filter((part): part is string => Boolean(part))
    .join(". ");

  return (
    <>
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={spoken}
        onPress={close}
        style={[styles.receipt, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: t.ink3 }]}>
          You answered
        </Text>
        {summary ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.answer, { color: t.ink }]}>
            {summary}
          </Text>
        ) : null}
        {reply ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.extra, { color: t.ink2 }]}>
            {`“${reply}”`}
          </Text>
        ) : null}
        {files ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.extra, { color: t.ink2 }]}>
            {files}
          </Text>
        ) : null}
        <View style={styles.status}>
          {line.icon === "spinner" ? (
            <Spinner />
          ) : line.icon === "warn" ? (
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path
                d={WARN_PATH}
                fill="none"
                stroke={colour}
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          ) : (
            <Glyph d={ICON.check} size={18} colour={colour} width={2.6} />
          )}
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.statusText, { color: colour }, styles.statusFlex]}
          >
            {line.text}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.next, { color: t.ink3 }]}>
          Tap to close
        </Text>
      </Pressable>
      <View style={styles.gap} />
    </>
  );
}

/**
 * The receipt state for the alert he just answered. `queued` is true while the answer waits on
 * the phone (A10) and `sentLocally` once the send call has returned. `clientId` is this phone's
 * client id, or null to skip the query (then the state follows the local facts only).
 */
export function useAnswerReceipt(input: {
  clientId: string | null;
  questionId: string;
  queued: boolean;
  sentLocally: boolean;
}): { state: ReceiptViewState; botName: string | null } {
  const result = useQuery(
    anyApi.answers.receipt,
    input.clientId && !input.queued ? { clientId: input.clientId, questionId: input.questionId } : "skip",
  ) as { state: ReceiptState; botName: string; attempts: number } | null | undefined;
  return {
    state: receiptViewState({
      queued: input.queued,
      server: result?.state ?? null,
      sentLocally: input.sentLocally,
    }),
    botName: result?.botName ?? null,
  };
}

const styles = StyleSheet.create({
  receipt: {
    alignItems: "center",
    borderRadius: radii.card,
    borderWidth: 1.5,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  label: {
    fontFamily: fontFamily.extraBold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 13 * 0.07,
    textTransform: "uppercase",
  },
  answer: {
    fontFamily: fontFamily.black,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 6,
    textAlign: "center",
  },
  extra: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    fontWeight: "600",
    marginTop: 6,
    textAlign: "center",
  },
  status: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 },
  statusText: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800", textAlign: "center" },
  statusFlex: { flexShrink: 1 },
  next: { marginTop: 14, fontFamily: fontFamily.extraBold, fontSize: 14, fontWeight: "800" },
  gap: { height: 52 },
});
