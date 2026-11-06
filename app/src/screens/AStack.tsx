/**
 * A8 Several waiting: the stack. Prototype: the stacked branch of `alertScreen`, `wireStack()`,
 * `advance()` and `finishAnswer()` in the stacked case
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` A8; `User journeys.md` J7;
 * Q20 and Q24.
 *
 * - The alerts are ordered urgent first, then oldest first (`orderStack`). The screen owns which
 *   card is in front (by `questionId`, so a new alert arriving does not move him) and draws the
 *   `Stack` with one `StackCard` per alert, plus a last slot for the summary.
 * - Answering never waits (Q24): a card's answer goes to `onAnswer`, the card at once shows its
 *   answered block ("Sending…"), and about 0.7 s later the stack moves to the next unanswered
 *   card, or to the summary when none is left. A rejected `onAnswer` brings the card back with a
 *   Toast. Without `answers` the screen tracks that much itself (sending, then sent when
 *   `onAnswer` resolves); `answers` (by `questionId`) overrides it with live statuses.
 * - The summary slot is `renderSummary`'s card, or a placeholder until it is built.
 * - A single alert is not a stack (the caller shows the normal screen), but one is drawn without
 *   crashing: the card and the summary, which a drag or the icon switches between.
 *
 * Reply, Snooze, the sending itself and the summary are the caller's (card T41).
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PendingAlert } from "../ChoiceScreen";
import { readableError } from "../session";
import { nextUnansweredSlot, orderStack, stackCaption } from "../stackOrder";
import { botLook } from "../ui/botLook";
import { Stack, type StackExtra, type StackItem } from "../ui/Stack";
import { StackCard, type StackAnswer } from "../ui/StackCard";
import { useTheme } from "../ui/theme";
import { Toast, useToast } from "../ui/Toast";
import { fontFamily } from "../ui/tokens";
import { haptics } from "../ui/useTapTwice";

export type { StackAnswer };

export interface AStackSummaryContext {
  /** The alerts in stack order. */
  alerts: readonly PendingAlert[];
  /** Every answer so far, by `questionId`. */
  answers: Readonly<Record<string, StackAnswer>>;
  /** Brings that alert's card to the front (a tap on a summary row). */
  jumpTo: (questionId: string) => void;
}

export interface AStackProps {
  /** Any order; the screen orders them. */
  alerts: readonly PendingAlert[];
  /** Sends an answer. Rejecting brings the card back with the error. */
  onAnswer: (alert: PendingAlert, optionIds: string[], customReply?: string) => void | Promise<void>;
  /** Live answers by `questionId`, over what the screen tracks itself. */
  answers?: Readonly<Record<string, StackAnswer>>;
  /** Opens the reply sheet (A5) for that alert. */
  onReply?: (alert: PendingAlert) => void;
  /** Opens the snooze choices (A11) for that alert. */
  onSnooze?: (alert: PendingAlert) => void;
  /** The summary card's content (it fills the card). Left out, a placeholder. */
  renderSummary?: (context: AStackSummaryContext) => ReactNode;
}

const SUMMARY_KEY = "__summary";
/** `setTimeout(()=>{ if(S.cur===a){ advance(); } }, 700)` in `finishAnswer()`. */
const ADVANCE_MS = 700;

export function AStack({ alerts, onAnswer, answers, onReply, onSnooze, renderSummary }: AStackProps) {
  const t = useTheme().tokens;
  const toast = useToast();
  const showToast = toast.show;
  const ordered = useMemo(() => orderStack(alerts), [alerts]);
  const [currentKey, setCurrentKey] = useState<string>(() => ordered[0]?.questionId ?? SUMMARY_KEY);
  const [local, setLocal] = useState<Record<string, StackAnswer>>({});
  const merged = useMemo(() => ({ ...local, ...answers }), [local, answers]);

  const index = useMemo(() => {
    if (currentKey === SUMMARY_KEY) return ordered.length;
    const found = ordered.findIndex((a) => a.questionId === currentKey);
    return found < 0 ? 0 : found;
  }, [currentKey, ordered]);

  // What the delayed advance needs to see at the moment it runs.
  const latest = useRef({ ordered, merged, currentKey });
  latest.current = { ordered, merged, currentKey };
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  const selectSlot = useCallback(
    (slot: number) => {
      const target = ordered[slot];
      setCurrentKey(target ? target.questionId : SUMMARY_KEY);
    },
    [ordered],
  );

  /** `advance()`: the next card still unanswered, else the summary. */
  const advanceFrom = useCallback((questionId: string) => {
    const { ordered: list, merged: all, currentKey: now } = latest.current;
    // He has already moved on (a drag, a blob): leave him where he is.
    if (now !== questionId) return;
    const from = list.findIndex((a) => a.questionId === questionId);
    if (from < 0) return;
    const next = nextUnansweredSlot(
      list.map((a) => all[a.questionId] !== undefined),
      from,
    );
    const target = list[next];
    setCurrentKey(target ? target.questionId : SUMMARY_KEY);
  }, []);

  const handleAnswer = useCallback(
    async (alert: PendingAlert, optionIds: string[], customReply?: string) => {
      const id = alert.questionId;
      setLocal((all) => ({
        ...all,
        [id]: { optionIds, ...(customReply ? { customReply } : {}), status: "sending" },
      }));
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        advanceFrom(id);
      }, ADVANCE_MS);
      timers.current.add(timer);
      try {
        await onAnswer(alert, optionIds, customReply);
        setLocal((all) => {
          const current = all[id];
          return current && current.status === "sending" ? { ...all, [id]: { ...current, status: "sent" } } : all;
        });
      } catch (caught) {
        setLocal((all) => {
          const { [id]: _removed, ...rest } = all;
          return rest;
        });
        haptics.error();
        showToast(readableError(caught));
      }
    },
    [onAnswer, advanceFrom, showToast],
  );

  const items = useMemo<StackItem[]>(
    () =>
      ordered.map((alert) => {
        const answer = merged[alert.questionId];
        const status = answer?.status ?? "waiting";
        return {
          key: alert.questionId,
          bot: botLook({ botId: alert.botId, botName: alert.botName }),
          label: alert.botName,
          urgent: alert.priority === "urgent" && !answer,
          status,
          render: () => (
            <StackCard
              alert={alert}
              status={status}
              answer={answer}
              onAnswer={(optionIds, customReply) => void handleAnswer(alert, optionIds, customReply)}
              onReply={onReply ? () => onReply(alert) : undefined}
              onSnooze={onSnooze ? () => onSnooze(alert) : undefined}
              notify={showToast}
            />
          ),
        };
      }),
    [ordered, merged, handleAnswer, onReply, onSnooze, showToast],
  );

  const extra = useMemo<StackExtra>(
    () => ({
      key: SUMMARY_KEY,
      label: "Summary",
      render: () =>
        renderSummary ? (
          renderSummary({
            alerts: ordered,
            answers: merged,
            jumpTo: (questionId) => setCurrentKey(questionId),
          })
        ) : (
          <View style={styles.placeholder}>
            <Text style={[styles.placeholderText, { color: t.ink2 }]}>Summary coming</Text>
          </View>
        ),
    }),
    [renderSummary, ordered, merged, t.ink2],
  );

  if (ordered.length === 0) return <View style={[styles.empty, { backgroundColor: t.fill }]} />;

  const done = ordered.filter((a) => merged[a.questionId] !== undefined).length;
  return (
    <View style={styles.fill}>
      <Stack
        items={items}
        extra={extra}
        index={index}
        onIndexChange={selectSlot}
        caption={stackCaption(done, ordered.length)}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { flex: 1 },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22 },
  placeholderText: { fontFamily: fontFamily.extraBold, fontSize: 18, fontWeight: "800", textAlign: "center" },
});
