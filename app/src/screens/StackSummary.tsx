/**
 * The summary: the last card of the A8 stack. Prototype: `summaryBody()`, `.sumlist`, `.sumrow`,
 * `.sti` and `statusHTML(x, "icon")` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` A8 (Summary); `User journeys.md` J7.
 *
 * - The header is "2 of 3 answered" (or "All answered"); under it one line: "Answers send in the
 *   background. You can leave any time." while something is still on its way, else "Every bot has
 *   its answer." or "Swipe back to answer the rest.".
 * - One row per alert, in stack order: the bot's blob (still, 34 dp), the question, "You: <picks>"
 *   (or "Not answered yet" in amber), the live status line (`receiptLine`: "Sending…", "Sent",
 *   "Delivered to <bot>", ...) and the round status icon at the end. A tap on a row brings that
 *   alert's card to the front (`jumpTo`).
 * - An alert that is no longer needed shows what happened instead (`goneCopy`, from `gone`), dimmed,
 *   and is not counted in the total ("2 of 3" is of the alerts still needed).
 * - The button is "Done" once every needed alert is answered, else "Leave the rest for later"
 *   (`onDone` either way: the host closes the stack; unanswered alerts stay waiting on the server).
 *
 * It fills the stack card (`extra.render` in `AStack`) and sends nothing itself. Status changes are
 * spoken by `AStack` (a status that settles on a card that is not in front), so the rows are not
 * live regions.
 */
import { type ReactNode, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PendingAlert } from "../ChoiceScreen";
import { Spinner } from "../onboarding/parts";
import { answerSummary, attachmentSummary, receiptLine, type StatusTone } from "../receiptCopy";
import { Glyph, ICON } from "../ui/AlertFrame";
import { Blob } from "../ui/Blob";
import { botLook } from "../ui/botLook";
import { Btn } from "../ui/Btn";
import type { StackAnswer, StackGone } from "../ui/StackCard";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";

const MAX_FONT_SCALE = 1.3;
/** `ICON.warn` of the prototype (24 x 24). */
const WARN = "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";

export interface StackSummaryProps {
  /** The alerts in stack order. */
  alerts: readonly PendingAlert[];
  /** Every answer so far, by `questionId`, with its live status. */
  answers: Readonly<Record<string, StackAnswer>>;
  /** The alerts that are no longer needed, by `questionId`. */
  gone?: Readonly<Record<string, StackGone>>;
  /** Brings that alert's card to the front. */
  jumpTo: (questionId: string) => void;
  /** Done, or Leave the rest for later: the host closes the stack. */
  onDone: () => void;
}

/** What he answered, as one line after "You: ": the picks, his own words, the files. */
export function pickedText(alert: PendingAlert, answer: StackAnswer): string {
  const labels = answer.optionIds.map((id) => alert.options.find((option) => option.id === id)?.label ?? id);
  const parts = [
    answerSummary(labels),
    answer.customReply ? `“${answer.customReply}”` : "",
    attachmentSummary(answer.attachments?.map((name) => ({ type: "file" as const, name }))) ?? "",
  ].filter((part) => part.length > 0);
  return parts.join(", ");
}

export function StackSummary({ alerts, answers, gone, jumpTo, onDone }: StackSummaryProps) {
  const t = useTheme().tokens;
  const isGone = (alert: PendingAlert) => answers[alert.questionId] === undefined && gone?.[alert.questionId] !== undefined;
  const needed = alerts.filter((alert) => !isGone(alert));
  const done = needed.filter((alert) => answers[alert.questionId] !== undefined).length;
  const all = done === needed.length;
  const busy = needed.some((alert) => {
    const answer = answers[alert.questionId];
    return answer !== undefined && answer.status !== "delivered";
  });

  const title = needed.length === 0 ? "Nothing left to answer" : all ? "All answered" : `${done} of ${needed.length} answered`;
  const message =
    needed.length === 0
      ? null
      : busy
        ? "Answers send in the background. You can leave any time."
        : all
          ? "Every bot has its answer."
          : "Swipe back to answer the rest.";

  return (
    <View style={styles.fill}>
      <ScrollView
        style={styles.amid}
        contentContainerStyle={styles.amidContent}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: t.ink }]}>
          {title}
        </Text>
        {message ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.message, { color: t.ink2 }]}>
            {message}
          </Text>
        ) : null}
        <View style={styles.list}>
          {alerts.map((alert) => (
            <SummaryRow
              key={alert.questionId}
              alert={alert}
              answer={answers[alert.questionId]}
              gone={isGone(alert) ? gone?.[alert.questionId] : undefined}
              onPress={() => jumpTo(alert.questionId)}
            />
          ))}
        </View>
        <View style={styles.spacer} />
      </ScrollView>
      <View style={styles.bottom}>
        <Btn label={all ? "Done" : "Leave the rest for later"} variant="primary" onPress={onDone} />
        <View style={styles.bottomGap} />
      </View>
    </View>
  );
}

function SummaryRow({
  alert,
  answer,
  gone,
  onPress,
}: {
  alert: PendingAlert;
  answer: StackAnswer | undefined;
  gone: StackGone | undefined;
  onPress: () => void;
}) {
  const t = useTheme().tokens;
  const { botId, botName } = alert;
  const bot = useMemo(() => botLook({ botId, botName }), [botId, botName]);
  const line = answer ? receiptLine(answer.status, botName) : null;
  const picked = answer ? pickedText(alert, answer) : "";
  const lineColour = (tone: StatusTone) => (tone === "ok" ? t.ok : tone === "warn" ? t.warn : t.ink2);

  const second = answer
    ? picked.length > 0
      ? `You: ${picked}`
      : "You answered"
    : gone
      ? gone.title
      : "Not answered yet";
  const secondColour = answer ? t.ink2 : gone ? t.ink3 : t.warn;
  const spoken = [botName, alert.question, second, line?.text, gone?.sub ?? null]
    .filter((part): part is string => Boolean(part))
    .join(". ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens that card"
      onPress={onPress}
      style={[styles.row, { borderTopColor: t.line }, gone ? styles.rowGone : null]}
    >
      <Blob bot={bot} size={34} />
      <View style={styles.main}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.question, { color: t.ink }]}>
          {alert.question}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.second, { color: secondColour }]}>
          {second}
        </Text>
        {line ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.second, { color: lineColour(line.tone) }]}>
            {line.text}
          </Text>
        ) : null}
      </View>
      {line ? <StatusIcon icon={line.icon} tone={line.tone} /> : null}
    </Pressable>
  );
}

/** `.sti`: a 26 dp circle with the status glyph; delivered is green on `okbg`, queued and failed amber. */
function StatusIcon({ icon, tone }: { icon: "spinner" | "check" | "warn"; tone: StatusTone }): ReactNode {
  const t = useTheme().tokens;
  const colour = tone === "ok" ? t.ok : tone === "warn" ? t.warn : t.ink3;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.sti, { backgroundColor: tone === "ok" ? t.okbg : t.fill }]}
    >
      {icon === "spinner" ? (
        <Spinner size={12} />
      ) : icon === "warn" ? (
        <Glyph d={WARN} size={14} colour={colour} width={3} />
      ) : (
        <Glyph d={ICON.check} size={14} colour={colour} width={3} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /** `.acard .amid{padding:4px 22px 0}`, `align-items:stretch; text-align:left` */
  amid: { flex: 1, minHeight: 0 },
  amidContent: { flexGrow: 1, paddingTop: 4, paddingHorizontal: 22 },
  /** `.acard .q{font-size:25px}` with `margin-top:22px` in `summaryBody()` */
  title: {
    fontFamily: fontFamily.extraBold,
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 25 * 1.14,
    letterSpacing: 25 * -0.015,
    marginTop: 22,
  },
  /** `p.msg` with `margin-top:6px` */
  message: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 16 * 1.45,
    marginTop: 6,
  },
  list: { marginTop: 16, alignSelf: "stretch" },
  /** `.sumrow{gap:12px; padding:12px 2px; border-top:1px solid var(--line)}` */
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderTopWidth: 1,
  },
  rowGone: { opacity: 0.5 },
  main: { flex: 1, minWidth: 0 },
  /** `.sumrow .t2{font-weight:800; line-height:1.25}` */
  question: { fontFamily: fontFamily.extraBold, fontSize: 16, fontWeight: "800", lineHeight: 16 * 1.25 },
  /** `.sumrow .t3{font-size:13.5px; font-weight:700; margin-top:3px}` */
  second: { fontFamily: fontFamily.bold, fontSize: 13.5, fontWeight: "700", marginTop: 3 },
  sti: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  spacer: { flex: 1, minHeight: 14 },
  /** `.acard .abottom{padding:4px 14px 0}` */
  bottom: { paddingTop: 4, paddingHorizontal: 14 },
  bottomGap: { height: 16 },
});
