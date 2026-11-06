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
 * - Answers that come from outside (the reply sheet, which the caller runs) arrive in `answers`
 *   without going through `onAnswer`; the screen moves on for those too. A card that leaves
 *   `alerts` while in front (snoozed) hands the front to the next unanswered one.
 * - `gone` marks alerts that are no longer needed (cancelled, expired, answered elsewhere): the
 *   card is greyed with the words, it is skipped by the advance, and it is left out of the counts.
 * - A status that settles on a card that is not in front ("Delivered to ...", "Couldn't reach ...",
 *   "Waiting for network") is announced to a screen reader; the front card's own live region
 *   speaks for itself.
 *
 * Reply, Snooze and the sending itself are the caller's (card T41, `StackHost`).
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import type { PendingAlert } from "../ChoiceScreen";
import { receiptLine } from "../receiptCopy";
import { readableError } from "../session";
import { nextUnansweredSlot, orderStack, stackCaption } from "../stackOrder";
import { botLook } from "../ui/botLook";
import { Stack, type StackExtra, type StackItem } from "../ui/Stack";
import { StackCard, type StackAnswer, type StackGone } from "../ui/StackCard";
import { useTheme } from "../ui/theme";
import { Toast, useToast } from "../ui/Toast";
import { fontFamily } from "../ui/tokens";
import { haptics } from "../ui/useTapTwice";

export type { StackAnswer, StackGone };

export interface AStackSummaryContext {
  /** The alerts in stack order. */
  alerts: readonly PendingAlert[];
  /** Every answer so far, by `questionId`. */
  answers: Readonly<Record<string, StackAnswer>>;
  /** The alerts that are no longer needed, by `questionId`. */
  gone: Readonly<Record<string, StackGone>>;
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
  /** Alerts that are no longer needed, by `questionId`: greyed, skipped, not counted. */
  gone?: Readonly<Record<string, StackGone>>;
  /** Opens the reply sheet (A5) for that alert. */
  onReply?: (alert: PendingAlert) => void;
  /** Opens the snooze choices (A11) for that alert. */
  onSnooze?: (alert: PendingAlert) => void;
  /** The summary card's content (it fills the card). Left out, a placeholder. */
  renderSummary?: (context: AStackSummaryContext) => ReactNode;
}

const SUMMARY_KEY = "__summary";
const NO_GONE: Readonly<Record<string, StackGone>> = {};
/** The settled states worth saying aloud when the card is not in front. */
const ANNOUNCED = new Set(["delivered", "failed", "queued"]);
/** `setTimeout(()=>{ if(S.cur===a){ advance(); } }, 700)` in `finishAnswer()`. */
const ADVANCE_MS = 700;

export function AStack({ alerts, onAnswer, answers, gone: goneProp, onReply, onSnooze, renderSummary }: AStackProps) {
  const gone = goneProp ?? NO_GONE;
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
  const latest = useRef({ ordered, merged, currentKey, gone });
  latest.current = { ordered, merged, currentKey, gone };
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
    const { ordered: list, merged: all, currentKey: now, gone: lost } = latest.current;
    // He has already moved on (a drag, a blob): leave him where he is.
    if (now !== questionId) return;
    const from = list.findIndex((a) => a.questionId === questionId);
    if (from < 0) return;
    const next = nextUnansweredSlot(
      list.map((a) => all[a.questionId] !== undefined || lost[a.questionId] !== undefined),
      from,
    );
    const target = list[next];
    setCurrentKey(target ? target.questionId : SUMMARY_KEY);
  }, []);

  const scheduleAdvance = useCallback(
    (id: string) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        advanceFrom(id);
      }, ADVANCE_MS);
      timers.current.add(timer);
    },
    [advanceFrom],
  );

  // The ids that already have an answer, so one that shows up in `answers` by another road (the
  // reply sheet) is told apart and moves the stack on too.
  const known = useRef<Set<string> | null>(null);
  if (known.current === null) known.current = new Set(Object.keys(merged));
  useEffect(() => {
    const seen = known.current;
    if (!seen) return;
    for (const id of seen) if (merged[id] === undefined) seen.delete(id);
    for (const id of Object.keys(merged)) {
      if (seen.has(id)) continue;
      seen.add(id);
      scheduleAdvance(id);
    }
  }, [merged, scheduleAdvance]);

  // The front card left the list (snoozed): the next unanswered one comes forward.
  const lastIndex = useRef(0);
  useEffect(() => {
    if (currentKey === SUMMARY_KEY) return;
    const at = ordered.findIndex((a) => a.questionId === currentKey);
    if (at >= 0) {
      lastIndex.current = at;
      return;
    }
    if (ordered.length === 0) return;
    const next = nextUnansweredSlot(
      ordered.map((a) => merged[a.questionId] !== undefined || gone[a.questionId] !== undefined),
      lastIndex.current - 1,
    );
    const target = ordered[next];
    setCurrentKey(target ? target.questionId : SUMMARY_KEY);
  }, [currentKey, ordered, merged, gone]);

  // Say a status that settled on a card he is not looking at.
  const spoken = useRef<Record<string, string>>({});
  useEffect(() => {
    const before = spoken.current;
    const after: Record<string, string> = {};
    for (const alert of ordered) {
      const answer = merged[alert.questionId];
      if (!answer) continue;
      after[alert.questionId] = answer.status;
      const prev = before[alert.questionId];
      if (prev === undefined || prev === answer.status) continue;
      if (alert.questionId === latest.current.currentKey || !ANNOUNCED.has(answer.status)) continue;
      AccessibilityInfo.announceForAccessibility(
        `${alert.botName}: ${receiptLine(answer.status, alert.botName).text}`,
      );
    }
    spoken.current = after;
  }, [merged, ordered]);

  const handleAnswer = useCallback(
    async (alert: PendingAlert, optionIds: string[], customReply?: string) => {
      const id = alert.questionId;
      known.current?.add(id);
      setLocal((all) => ({
        ...all,
        [id]: { optionIds, ...(customReply ? { customReply } : {}), status: "sending" },
      }));
      scheduleAdvance(id);
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
    [onAnswer, scheduleAdvance, showToast],
  );

  const items = useMemo<StackItem[]>(
    () =>
      ordered.map((alert) => {
        const answer = merged[alert.questionId];
        const status = answer?.status ?? "waiting";
        const lost = answer ? undefined : gone[alert.questionId];
        return {
          key: alert.questionId,
          bot: botLook({ botId: alert.botId, botName: alert.botName }),
          label: alert.botName,
          urgent: alert.priority === "urgent" && !answer && !lost,
          status,
          ...(lost ? { note: "no longer needed" } : {}),
          render: () => (
            <StackCard
              alert={alert}
              status={status}
              answer={answer}
              gone={lost}
              onAnswer={(optionIds, customReply) => void handleAnswer(alert, optionIds, customReply)}
              onReply={onReply ? () => onReply(alert) : undefined}
              onSnooze={onSnooze ? () => onSnooze(alert) : undefined}
              notify={showToast}
            />
          ),
        };
      }),
    [ordered, merged, gone, handleAnswer, onReply, onSnooze, showToast],
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
            gone,
            jumpTo: (questionId) => setCurrentKey(questionId),
          })
        ) : (
          <View style={styles.placeholder}>
            <Text style={[styles.placeholderText, { color: t.ink2 }]}>Summary coming</Text>
          </View>
        ),
    }),
    [renderSummary, ordered, merged, gone, t.ink2],
  );

  if (ordered.length === 0) return <View style={[styles.empty, { backgroundColor: t.fill }]} />;

  // A gone card is neither answered nor waiting: it is left out of both numbers.
  const needed = ordered.filter((a) => gone[a.questionId] === undefined || merged[a.questionId] !== undefined);
  const done = needed.filter((a) => merged[a.questionId] !== undefined).length;
  return (
    <View style={styles.fill}>
      <Stack
        items={items}
        extra={extra}
        index={index}
        onIndexChange={selectSlot}
        caption={stackCaption(done, needed.length)}
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
