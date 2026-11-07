/**
 * The connected A8 stack: `AStack` with the real sending, the live statuses, the summary and the
 * way out (card T41). `Inbox` shows it when two or more alerts are waiting; `AlertHost` stays for one.
 *
 * - **Held list.** Once the stack is showing it stays a stack until Done, even though `alerts.pending`
 *   drops each alert as it is answered: the host keeps the alerts it has seen (by `questionId`) and
 *   adds any new one that arrives. Answered alerts stay, as answered cards.
 * - **Background sending.** `onAnswer` runs the same pipeline as `AlertHost` (the unlock check
 *   first, then `answerPayloadFor` and `deliverAnswer`: recorded, or queued on the phone when the
 *   connection is down) but never holds the screen: the card turns to "Sending…" at once and `AStack`
 *   moves on after 0.7 s. A throw (locked, offline error, refused) returns the card to waiting.
 *   Nothing leaves the screen per answer: `leaveIfLocked` and `goBack` run only on Done.
 * - **Live statuses.** Each answered alert has a watcher (`AnswerWatcher`, renders nothing) that
 *   calls `useAnswerReceipt` and reports the state up; the map goes to `AStack`'s `answers`, so the
 *   card, the blob's dot and the summary row follow the delivery (sending, sent, delivered, failed,
 *   queued).
 * - **Gone cards.** Each unanswered alert has a watcher (`AlertWatcher`) too. One that is cancelled,
 *   expired or answered elsewhere keeps its card, greyed with A9's words (`goneCopy`), and is left
 *   out of "N of M answered". One that merely left the list (snoozed on another client) is let go.
 * - **Reply and Snooze** from a card open the same sheets as `AlertHost` (`A5Reply`, `A11Snooze`).
 *   A reply answers the card like an option does; a snooze takes the card out of the stack.
 * - **Done / Leave the rest for later** (the summary's button): clears the displayed notifications of
 *   the answered alerts, steps back (`leaveIfLocked`, then `goBack` when an alert launched the app and
 *   the phone was not locked: the same rule as `AlertHost`) and tells `Inbox` to close the stack with
 *   the ids it held. Alerts left unanswered stay pending on the server.
 *
 * It needs the Convex provider. The dev sample route uses `AStack` and `StackSummary` directly.
 */
import { anyApi } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { goBack, leaveIfLocked } from "puck-full-screen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { PendingAlert } from "../ChoiceScreen";
import { isQueuedLocally } from "../answerQueue";
import type { UploadedAttachment } from "../attachments";
import { readClientId } from "../clientStore";
import { goneCopy, shouldGoBack, type ReceiptViewState } from "../receiptCopy";
import { useAnnounceNewAlerts } from "../ui/announce";
import { botLook } from "../ui/botLook";
import type { StackAnswer, StackGone } from "../ui/StackCard";
import { ensureUnlockedFor } from "../unlock";
import { clearDisplayedAlert } from "../urgentDisplay";
import { A5Reply } from "./A5Reply";
import { useOnline } from "./A10Offline";
import { useAnswerReceipt } from "./A7Receipt";
import { useAlertGone, type AlertGoneState } from "./A9Gone";
import { A11Snooze } from "./A11Snooze";
import { answerPayloadFor, deliverAnswer, useExpired } from "./AlertHost";
import { AStack, type AStackSummaryContext } from "./AStack";
import { StackSummary } from "./StackSummary";

export interface StackHostProps {
  /** The alerts waiting now (not snoozed, not expired). New ones join the stack; none leave it by themselves. */
  alerts: readonly PendingAlert[];
  /** An alert is what opened the app (a notification or the full-screen intent). */
  launchedByAlert: boolean;
  /** The stack is finished (Done, or Leave the rest for later). Gets every `questionId` it held. */
  onClose: (heldIds: string[]) => void;
}

/** What he sent for one alert, and where it is on the phone. */
interface Entry {
  optionIds: string[];
  customReply?: string;
  /** "a photo", "report.pdf": what the answered card shows after "+". */
  attachments?: string[];
  /** The send call has returned: Puck has the answer. */
  sentLocally: boolean;
  /** The answer waits on the phone (A10). */
  queued: boolean;
}

interface WatchReport {
  /** The alert was missing from the list when this was worked out (so a stale report is not trusted). */
  missing: boolean;
  gone: AlertGoneState | null;
  /** Still finding out whether the alert is gone (only while it is missing from the list). */
  loading: boolean;
}

/** How long to wait for `alerts.state` before letting a vanished alert go (as `AlertHost` does). */
const STATE_WAIT_MS = 2500;

export function StackHost({ alerts, launchedByAlert, onClose }: StackHostProps) {
  const record = useMutation(anyApi.answers.record);
  const snooze = useMutation(anyApi.answers.snooze);
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const launchedRef = useRef(launchedByAlert);
  if (launchedByAlert) launchedRef.current = true;

  // undefined while the stored client id loads; null when this install has none (legacy device path).
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    readClientId()
      .then(setClientId)
      .catch(() => setClientId(null));
  }, []);
  const clients = useQuery(anyApi.clients.list, clientId ? {} : "skip") as { id: string; name: string }[] | undefined;
  const ownName = clients?.find((client) => client.id === clientId)?.name ?? null;

  // ---- the held list
  const [held, setHeld] = useState<PendingAlert[]>(() => [...alerts]);
  /** Alerts let go of (snoozed, vanished): they must not come back in from a stale `alerts`. */
  const dropped = useRef(new Set<string>());
  useEffect(() => {
    setHeld((before) => {
      const seen = new Set(before.map((alert) => alert.questionId));
      const fresh = alerts.filter((alert) => !seen.has(alert.questionId) && !dropped.current.has(alert.questionId));
      return fresh.length > 0 ? [...before, ...fresh] : before;
    });
  }, [alerts]);
  useAnnounceNewAlerts(
    held.map((alert) => ({ id: alert.questionId, botName: alert.botName, question: alert.question, priority: alert.priority })),
    held.length,
  );
  const drop = useCallback((questionId: string) => {
    dropped.current.add(questionId);
    setHeld((before) => before.filter((alert) => alert.questionId !== questionId));
  }, []);

  // ---- the answers
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [states, setStates] = useState<Record<string, ReceiptViewState>>({});
  const [reports, setReports] = useState<Record<string, WatchReport>>({});

  const submit = useCallback(
    async (alert: PendingAlert, optionIds: string[], customReply?: string, attachments?: UploadedAttachment[]) => {
      const { questionId } = alert;
      // On the lock screen a destructive option, or a `requiresUnlock` alert, asks to unlock first.
      // A throw here brings the card back to waiting with a Toast (Q9, Q10).
      await ensureUnlockedFor(alert, optionIds);
      const payload = answerPayloadFor(optionIds, customReply, attachments);
      setEntries((all) => ({
        ...all,
        [questionId]: {
          optionIds: payload.optionIds,
          ...(payload.customReply ? { customReply: payload.customReply } : {}),
          ...(attachments && attachments.length > 0
            ? { attachments: attachments.map((item) => (item.type === "file" ? item.name : "a photo")) }
            : {}),
          sentLocally: false,
          queued: false,
        },
      }));
      try {
        const id = await readClientId();
        const outcome = await deliverAnswer({
          alert,
          payload,
          attachments,
          clientId: id,
          online: onlineRef.current,
          record,
        });
        setEntries((all) => {
          const entry = all[questionId];
          return entry ? { ...all, [questionId]: { ...entry, queued: outcome === "queued", sentLocally: outcome === "sent" } } : all;
        });
      } catch (error) {
        setEntries((all) => {
          const { [questionId]: _removed, ...rest } = all;
          return rest;
        });
        throw error;
      }
      await clearDisplayedAlert(questionId);
    },
    [record],
  );

  const onAnswer = useCallback(
    (alert: PendingAlert, optionIds: string[], customReply?: string) => submit(alert, optionIds, customReply),
    [submit],
  );

  // A queued answer is sent by the flush in `App.tsx`; once it has gone, move its status on from
  // "Waiting for network" (the server's view takes over from there).
  const anyQueued = Object.values(entries).some((entry) => entry.queued);
  useEffect(() => {
    if (!anyQueued) return;
    const id = setInterval(() => {
      setEntries((all) => {
        let changed = false;
        const next: Record<string, Entry> = {};
        for (const [questionId, entry] of Object.entries(all)) {
          if (entry.queued && !isQueuedLocally(questionId)) {
            changed = true;
            next[questionId] = { ...entry, queued: false, sentLocally: true };
          } else {
            next[questionId] = entry;
          }
        }
        return changed ? next : all;
      });
    }, 500);
    return () => clearInterval(id);
  }, [anyQueued]);

  const reportState = useCallback((questionId: string, state: ReceiptViewState | null) => {
    setStates((all) => {
      if (state === null) {
        if (all[questionId] === undefined) return all;
        const { [questionId]: _removed, ...rest } = all;
        return rest;
      }
      return all[questionId] === state ? all : { ...all, [questionId]: state };
    });
  }, []);

  const reportWatch = useCallback((questionId: string, report: WatchReport | null) => {
    setReports((all) => {
      if (report === null) {
        if (all[questionId] === undefined) return all;
        const { [questionId]: _removed, ...rest } = all;
        return rest;
      }
      const before = all[questionId];
      if (
        before &&
        before.missing === report.missing &&
        before.loading === report.loading &&
        JSON.stringify(before.gone) === JSON.stringify(report.gone)
      ) {
        return all;
      }
      return { ...all, [questionId]: report };
    });
  }, []);

  /** `AStack`'s `answers`: what was sent, with the live status. */
  const answers = useMemo(() => {
    const out: Record<string, StackAnswer> = {};
    for (const [questionId, entry] of Object.entries(entries)) {
      const status: ReceiptViewState =
        states[questionId] ?? (entry.queued ? "queued" : entry.sentLocally ? "sent" : "sending");
      out[questionId] = {
        optionIds: entry.optionIds,
        ...(entry.customReply ? { customReply: entry.customReply } : {}),
        ...(entry.attachments ? { attachments: entry.attachments } : {}),
        status,
      };
    }
    return out;
  }, [entries, states]);

  // ---- no longer needed
  const liveIds = useMemo(() => new Set(alerts.map((alert) => alert.questionId)), [alerts]);
  const gone = useMemo(() => {
    const out: Record<string, StackGone> = {};
    for (const alert of held) {
      const lost = entries[alert.questionId] ? undefined : reports[alert.questionId]?.gone;
      if (!lost) continue;
      const copy = goneCopy({
        reason: lost.reason,
        botName: alert.botName,
        ...(lost.clientName ? { clientName: lost.clientName } : {}),
        ...(lost.answerLabels ? { answerLabels: lost.answerLabels } : {}),
        ...(lost.expiredAt === undefined ? {} : { expiredAt: lost.expiredAt }),
      });
      out[alert.questionId] = { title: copy.title, sub: copy.sub };
    }
    return out;
  }, [held, entries, reports]);

  // An alert that left the list, is not gone and was not answered here (snoozed elsewhere) has
  // nothing to show: let it go.
  useEffect(() => {
    for (const alert of held) {
      const { questionId } = alert;
      if (entries[questionId] || liveIds.has(questionId)) continue;
      const report = reports[questionId];
      if (report && report.missing && !report.gone && !report.loading) drop(questionId);
    }
  }, [held, entries, liveIds, reports, drop]);

  // ---- reply (A5) and snooze (A11)
  const [replyAlert, setReplyAlert] = useState<PendingAlert | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [snoozeAlert, setSnoozeAlert] = useState<PendingAlert | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const openReply = useCallback((alert: PendingAlert) => {
    setReplyAlert(alert);
    setReplyOpen(true);
  }, []);
  const openSnooze = useCallback((alert: PendingAlert) => {
    setSnoozeAlert(alert);
    setSnoozeOpen(true);
  }, []);
  const snoozeBot = useMemo(
    () => (snoozeAlert ? botLook({ botId: snoozeAlert.botId, botName: snoozeAlert.botName }) : null),
    [snoozeAlert],
  );
  const onSnoozeChoose = useCallback(
    async (until: number | null) => {
      if (!snoozeAlert) return;
      const id = await readClientId();
      if (!id) throw new Error("Sign in to snooze alerts");
      if (!onlineRef.current) throw new Error("You're offline. Snoozing needs a connection.");
      await snooze({ clientId: id, questionId: snoozeAlert.questionId, until });
      await clearDisplayedAlert(snoozeAlert.questionId);
      // Snoozing takes the card out of the stack (A8).
      drop(snoozeAlert.questionId);
    },
    [snoozeAlert, snooze, drop],
  );

  // ---- the way out
  const heldRef = useRef(held);
  heldRef.current = held;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    const ids = heldRef.current.map((alert) => alert.questionId);
    for (const id of ids) if (entriesRef.current[id]) void clearDisplayedAlert(id);
    const leftLockScreen = leaveIfLocked();
    if (shouldGoBack({ launchedByAlert: launchedRef.current, leftLockScreen })) goBack();
    onClose(ids);
  }, [onClose]);

  // Every card snoozed or let go: nothing is left to show.
  useEffect(() => {
    if (held.length === 0 && !finished.current) {
      finished.current = true;
      onClose([]);
    }
  }, [held.length, onClose]);

  const renderSummary = useCallback(
    (context: AStackSummaryContext) => (
      <StackSummary
        alerts={context.alerts}
        answers={context.answers}
        gone={context.gone}
        jumpTo={context.jumpTo}
        onDone={finish}
      />
    ),
    [finish],
  );

  return (
    <View style={styles.fill}>
      <AStack
        alerts={held}
        onAnswer={onAnswer}
        answers={answers}
        gone={gone}
        onReply={openReply}
        onSnooze={openSnooze}
        renderSummary={renderSummary}
      />
      {held.map((alert) => {
        const entry = entries[alert.questionId];
        return entry ? (
          <AnswerWatcher
            key={alert.questionId}
            questionId={alert.questionId}
            clientId={clientId ?? null}
            queued={entry.queued}
            sentLocally={entry.sentLocally}
            onState={reportState}
          />
        ) : (
          <AlertWatcher
            key={alert.questionId}
            alert={alert}
            missing={!liveIds.has(alert.questionId)}
            clientId={clientId ?? null}
            ownName={ownName}
            onReport={reportWatch}
          />
        );
      })}
      {replyAlert ? (
        <A5Reply
          key={replyAlert.questionId}
          visible={replyOpen}
          onClose={() => setReplyOpen(false)}
          alert={replyAlert}
          onSend={async (optionIds, customReply, attachments) => {
            await submit(replyAlert, optionIds, customReply, attachments);
            setReplyOpen(false);
          }}
        />
      ) : null}
      {snoozeAlert && snoozeBot ? (
        <A11Snooze visible={snoozeOpen} onClose={() => setSnoozeOpen(false)} bot={snoozeBot} onChoose={onSnoozeChoose} />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------- watchers */

/** One per answered alert: the live delivery state, reported up. Renders nothing. */
function AnswerWatcher({
  questionId,
  clientId,
  queued,
  sentLocally,
  onState,
}: {
  questionId: string;
  clientId: string | null;
  queued: boolean;
  sentLocally: boolean;
  onState: (questionId: string, state: ReceiptViewState | null) => void;
}) {
  const receipt = useAnswerReceipt({ clientId, questionId, queued, sentLocally });
  const { state } = receipt;
  useEffect(() => {
    onState(questionId, state);
  }, [questionId, state, onState]);
  useEffect(() => () => onState(questionId, null), [questionId, onState]);
  return null;
}

/**
 * One per unanswered alert: whether it is no longer needed (its `expiresAt` passed, or, once it has
 * left `alerts.pending`, what `alerts.state` says: cancelled, expired, answered elsewhere). Renders nothing.
 */
function AlertWatcher({
  alert,
  missing,
  clientId,
  ownName,
  onReport,
}: {
  alert: PendingAlert;
  /** The alert is no longer in the list of waiting alerts. */
  missing: boolean;
  clientId: string | null;
  ownName: string | null;
  onReport: (questionId: string, report: WatchReport | null) => void;
}) {
  const { questionId } = alert;
  const expired = useExpired(alert.expiresAt);
  const ready = clientId !== null && ownName !== null;
  const server = useAlertGone({ clientId: missing && ready ? clientId : null, questionId, ownClientName: ownName });
  const gone: AlertGoneState | null =
    server.gone ?? (expired && alert.expiresAt !== undefined ? { reason: "expired", expiredAt: alert.expiresAt } : null);
  const waiting = missing && !gone && clientId !== null && (!ready || server.loading);

  // Give `alerts.state` a moment, then stop waiting for it.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => setTimedOut(true), STATE_WAIT_MS);
    return () => clearTimeout(id);
  }, [waiting]);
  const loading = waiting && !timedOut;

  const key = JSON.stringify([missing, gone, loading]);
  useEffect(() => {
    onReport(questionId, { missing, gone, loading });
    // `key` stands for `missing`, `gone` and `loading`, which are new objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, key, onReport]);
  useEffect(() => () => onReport(questionId, null), [questionId, onReport]);
  return null;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
