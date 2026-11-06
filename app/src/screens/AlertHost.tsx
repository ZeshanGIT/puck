/**
 * The one place that turns a `PendingAlert` into a screen, and the flow around it.
 *
 * - `selectionMode: "single"` with `presentation: "choice"` is A1 (`A1ChoiceSingle`), multi is A2,
 *   swipe is A3. Anything else falls back to the proof-of-concept `ChoiceScreen`.
 * - The host owns what happens around an answer (card T36):
 *   - **A7 receipt**: after an answer (from the options or the reply sheet) the screens show
 *     `A7Receipt`: Sent, then "Delivered to <bot>" from `answers.receipt`, then back to where he
 *     was (`leaveIfLocked()`, else `goBack()` if the alert launched the app, else stay) when
 *     nothing else is waiting.
 *   - **A10 offline**: an answer given while the Convex connection is down is queued on the phone
 *     (`answerQueue.ts`) and the receipt says "Waiting for network". `App.tsx` flushes the queue.
 *   - **A11 snooze**: `A11Snooze` calls `answers.snooze`; the alert leaves the screen.
 *   - **A9 gone**: when the alert is cancelled, expired or answered on another client, the screen
 *     dims and `A9Gone` asks him to continue (`alerts.state`, and a timer for `expiresAt`).
 *   - The unlock check (`ensureUnlockedFor`) still runs before an answer is sent.
 * - `useAlertDeck` is what `Inbox` uses to pick the alert and to keep it on screen after it has
 *   left `alerts.pending` (answered, cancelled, or waiting in the queue) until the receipt or the
 *   A9 card is done. The host calls `onRelease` when it is finished with a held alert.
 *
 * With `onAnswer` given the host is the dev sample route (`puck://dev-alert`): no backend, no
 * Convex hooks, a fixed receipt ("Delivered" once `onAnswer` has returned), and `onSnooze` (a Toast
 * in `App.tsx`) in place of `answers.snooze`.
 */
import { anyApi } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { goBack, isLocked, leaveIfLocked } from "puck-full-screen";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type PendingAlert, ChoiceScreen } from "../ChoiceScreen";
import { isQueuedLocally, submitOrQueue, type QueuedAnswer } from "../answerQueue";
import type { UploadedAttachment } from "../attachments";
import { replyPayload } from "../choice";
import { readClientId } from "../clientStore";
import { shouldGoBack, type ReceiptViewState } from "../receiptCopy";
import { useReadingAloud } from "../speak";
import { botLook } from "../ui/botLook";
import { ensureUnlockedFor } from "../unlock";
import { clearDisplayedAlert, useUrgentLook } from "../urgentDisplay";
import { A1ChoiceSingle } from "./A1ChoiceSingle";
import { A2ChoiceMulti } from "./A2ChoiceMulti";
import { A3Swipe } from "./A3Swipe";
import { A5Reply } from "./A5Reply";
import { useOnline } from "./A10Offline";
import { A7Receipt, useAnswerReceipt } from "./A7Receipt";
import { A9Gone, useAlertGone, type AlertGoneState } from "./A9Gone";
import { A11Snooze } from "./A11Snooze";

export type AnswerHandler = (optionIds: string[], customReply?: string, attachments?: UploadedAttachment[]) => Promise<void>;

export interface AlertHostProps {
  alert: PendingAlert;
  /**
   * How many alerts are waiting. While the alert is still pending it counts it; once it is `stale`
   * it does not.
   */
  waiting: number;
  /** The dev sample route's answer handler. Left out, answers go to Convex. */
  onAnswer?: AnswerHandler;
  /** The dev sample route's snooze handler (a Toast). Left out, snoozes go to Convex. */
  onSnooze?: (until: number | null) => Promise<void>;
  /**
   * The alert is what opened the app (a notification or the full-screen intent). Only then does
   * the host send Puck to the back when it is done; when he opened Puck himself it stays put.
   */
  launchedByAlert?: boolean;
  /** The alert has left `alerts.pending` and is only held on screen (see `useAlertDeck`). */
  stale?: boolean;
  /** The host is finished with a held alert: the receipt or the A9 card was closed. */
  onRelease?: () => void;
}

export function AlertHost({ alert, waiting, onAnswer, onSnooze, launchedByAlert, stale, onRelease }: AlertHostProps) {
  // Keyed by the question so the next alert starts fresh (blob arrives, nothing armed, no receipt).
  return onAnswer ? (
    <SampleAlertHost key={alert.questionId} alert={alert} waiting={waiting} onAnswer={onAnswer} onSnooze={onSnooze} />
  ) : (
    <ConnectedAlertHost
      key={alert.questionId}
      alert={alert}
      waiting={waiting}
      launchedByAlert={launchedByAlert === true}
      stale={stale === true}
      onRelease={onRelease}
    />
  );
}

/* ------------------------------------------------------------------- the deck */

/** Alerts whose A9 card he has closed. An expired alert stays `pending` on the server, so this keeps it off the screen. */
const hidden = new Set<string>();

/** Keeps an alert off the screen for good (this run of the app): its A9 card was closed. */
export function hideAlert(questionId: string): void {
  hidden.add(questionId);
}

/**
 * Picks the alert to show: the one a notification opened, else the oldest. Alerts he closed an A9
 * card for, and ones waiting in the offline queue, are left out. An alert already on screen that
 * leaves the list (he answered it, the bot cancelled it, it was answered elsewhere) is held, with
 * `stale` true, until `release` is called, so the receipt or the A9 card can show.
 */
export function useAlertDeck(
  pending: PendingAlert[] | undefined,
  openedId: string | null,
): { alert: PendingAlert | null; waiting: number; stale: boolean; release: () => void } {
  const [version, setVersion] = useState(0);
  const live = useMemo(
    () => (pending ?? []).filter((item) => !hidden.has(item.questionId) && !isQueuedLocally(item.questionId)),
    // `version` makes the filters apply again after a release.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, version],
  );
  const next = live.find((item) => item.questionId === openedId) ?? live[0] ?? null;
  const [held, setHeld] = useState<PendingAlert | null>(null);
  const heldGone = held !== null && !live.some((item) => item.questionId === held.questionId);
  useEffect(() => {
    if (heldGone) return;
    setHeld((previous) => (previous?.questionId === next?.questionId ? previous : next));
  }, [next, heldGone]);
  const release = useCallback(() => {
    setHeld(null);
    setVersion((value) => value + 1);
  }, []);
  return { alert: heldGone ? held : next, waiting: live.length, stale: heldGone, release };
}

/* ------------------------------------------------------------------ the host */

/** What he answered, for the receipt, plus where the answer is. */
interface AnsweredView {
  labels: string[];
  reply?: string;
  attachments?: { type: "photo" | "file"; name: string }[];
  /** The send call has returned: Puck has the answer. */
  sentLocally: boolean;
  /** The answer waits on the phone (A10). */
  queued: boolean;
}

function answeredView(
  alert: PendingAlert,
  optionIds: string[],
  reply: string | undefined,
  attachments: UploadedAttachment[] | undefined,
): AnsweredView {
  return {
    labels: optionIds.map((id) => alert.options.find((option) => option.id === id)?.label ?? id),
    ...(reply ? { reply } : {}),
    ...(attachments && attachments.length > 0
      ? { attachments: attachments.map(({ type, name }) => ({ type, name })) }
      : {}),
    sentLocally: false,
    queued: false,
  };
}

/** Longest `setTimeout` delay. */
const MAX_TIMER_MS = 2_147_483_647;

/** True once `expiresAt` has passed (it flips by itself at that moment). */
function useExpired(expiresAt: number | undefined): boolean {
  const [expired, setExpired] = useState(() => expiresAt !== undefined && Date.now() >= expiresAt);
  useEffect(() => {
    if (expiresAt === undefined) return;
    const left = expiresAt - Date.now();
    if (left <= 0) {
      setExpired(true);
      return;
    }
    const id = setTimeout(() => setExpired(true), Math.min(left, MAX_TIMER_MS));
    return () => clearTimeout(id);
  }, [expiresAt]);
  return expired;
}

/** The A9 card closes itself after this long on the lock screen, so it never holds it. */
const GONE_LOCKED_CLOSE_MS = 5000;

/** The Convex hooks need the provider, which is why the connected host is its own component. */
function ConnectedAlertHost({
  alert,
  waiting,
  launchedByAlert,
  stale,
  onRelease,
}: {
  alert: PendingAlert;
  waiting: number;
  launchedByAlert: boolean;
  stale: boolean;
  onRelease?: () => void;
}) {
  const { questionId } = alert;
  const record = useMutation(anyApi.answers.record);
  const snooze = useMutation(anyApi.answers.snooze);
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;

  // undefined while the stored client id loads; null when this install has none (legacy device path).
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    readClientId()
      .then(setClientId)
      .catch(() => setClientId(null));
  }, []);
  const clients = useQuery(anyApi.clients.list, clientId ? {} : "skip") as { id: string; name: string }[] | undefined;
  const ownName = clients?.find((client) => client.id === clientId)?.name ?? null;

  const [answered, setAnswered] = useState<AnsweredView | null>(null);
  const [snoozedDone, setSnoozedDone] = useState(false);

  // ---- leaving the screen
  const remaining = Math.max(0, stale ? waiting : waiting - 1);
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  const exited = useRef(false);
  const launchedRef = useRef(launchedByAlert);
  launchedRef.current = launchedByAlert;
  /**
   * Back to where he was once nothing else is waiting: the lock screen if the phone is locked;
   * else, when the alert is what opened Puck, the app he was in (or home). Otherwise stay.
   */
  const leave = useCallback(() => {
    if (exited.current) return;
    exited.current = true;
    if (remainingRef.current > 0) return;
    const leftLockScreen = leaveIfLocked();
    if (shouldGoBack({ launchedByAlert: launchedRef.current, leftLockScreen })) goBack();
  }, []);
  // If the screen goes away with a receipt still open (a parent that does not hold it), at least
  // give the lock screen back, as an answer always did.
  const answeredRef = useRef(answered);
  answeredRef.current = answered;
  useEffect(
    () => () => {
      if (answeredRef.current && !exited.current && remainingRef.current <= 0) leaveIfLocked();
    },
    [],
  );

  // ---- the answer (A7, A10)
  const onAnswer = useCallback<AnswerHandler>(
    async (optionIds, customReply, attachments) => {
      // On the lock screen a destructive option, or a `requiresUnlock` alert, asks to unlock first.
      // A throw here reaches the screen as a Toast and keeps the alert up (Q9, Q10).
      await ensureUnlockedFor(alert, optionIds);
      // `replyPayload` trims the reply and refuses an empty answer. A reply that is only
      // attachments is allowed.
      const hasFiles = (attachments?.length ?? 0) > 0;
      const payload = hasFiles
        ? { optionIds, customReply: (customReply ?? "").trim() }
        : replyPayload({
            mode: "multi",
            state: { armedId: null, selectedIds: optionIds },
            confirmId: null,
            customReply: customReply ?? "",
          });
      setAnswered(answeredView(alert, payload.optionIds, payload.customReply || undefined, attachments));
      const id = await readClientId();
      const item: QueuedAnswer = {
        questionId,
        optionIds: payload.optionIds,
        ...(payload.customReply ? { customReply: payload.customReply } : {}),
        ...(hasFiles && attachments ? { attachments } : {}),
        queuedAt: Date.now(),
        ...(alert.expiresAt === undefined ? {} : { expiresAt: alert.expiresAt }),
      };
      const send = (entry: QueuedAnswer) =>
        record({
          questionId,
          ...(id ? { clientId: id } : {}),
          optionIds: entry.optionIds,
          ...(entry.customReply ? { customReply: entry.customReply } : {}),
          ...(entry.attachments ? { attachments: entry.attachments } : {}),
        });
      try {
        // Offline, a signed-in phone keeps the answer and sends it later; the legacy device path
        // just sends (Convex holds the call until the connection is back).
        let outcome: "sent" | "queued" = "sent";
        if (id) outcome = await submitOrQueue({ online: onlineRef.current, item, send });
        else await send(item);
        setAnswered((view) => (view ? { ...view, queued: outcome === "queued", sentLocally: outcome === "sent" } : view));
      } catch (error) {
        setAnswered(null);
        throw error;
      }
      await clearDisplayedAlert(questionId);
    },
    [alert, questionId, record],
  );

  const receipt = useAnswerReceipt({
    clientId: answered && clientId ? clientId : null,
    questionId,
    queued: answered?.queued ?? false,
    sentLocally: answered?.sentLocally ?? false,
  });

  // A queued answer is sent by the flush in `App.tsx`; when it has gone, move the receipt on from
  // "Waiting for network" (the server's view takes over from there).
  const waitingOffline = answered?.queued === true;
  useEffect(() => {
    if (!waitingOffline) return;
    const id = setInterval(() => {
      if (!isQueuedLocally(questionId)) setAnswered((view) => (view ? { ...view, queued: false, sentLocally: true } : view));
    }, 500);
    return () => clearInterval(id);
  }, [waitingOffline, questionId]);

  const onReceiptDone = useCallback(() => {
    leave();
    onRelease?.();
  }, [leave, onRelease]);

  // The legacy device path has no `answers.receipt`: close the receipt a moment after it was sent.
  const legacySent = clientId === null && answered?.sentLocally === true;
  useEffect(() => {
    if (!legacySent) return;
    const id = setTimeout(onReceiptDone, 1500);
    return () => clearTimeout(id);
  }, [legacySent, onReceiptDone]);

  // ---- snooze (A11)
  const onSnoozeChoose = useCallback(
    async (until: number | null) => {
      const id = await readClientId();
      if (!id) throw new Error("Sign in to snooze alerts");
      if (!onlineRef.current) throw new Error("You're offline. Snoozing needs a connection.");
      await snooze({ clientId: id, questionId, until });
      await clearDisplayedAlert(questionId);
      leave();
      setSnoozedDone(true);
    },
    [snooze, questionId, leave],
  );

  // ---- no longer needed (A9)
  const expired = useExpired(alert.expiresAt);
  const server = useAlertGone({
    clientId: clientId && ownName !== null ? clientId : null,
    questionId,
    ownClientName: ownName,
  });
  const gone: AlertGoneState | null =
    answered || snoozedDone
      ? null
      : (server.gone ??
        (expired && alert.expiresAt !== undefined ? { reason: "expired", expiredAt: alert.expiresAt } : null));
  const onGoneDone = useCallback(() => {
    hideAlert(questionId);
    leave();
    onRelease?.();
  }, [questionId, leave, onRelease]);

  // A held alert that has nothing to show (snoozed here or elsewhere, the state is not gone) is let go.
  // Wait a moment for `alerts.state` first, so an A9 card is not missed.
  useEffect(() => {
    if (!stale || answered || gone) return;
    if (snoozedDone || !server.loading) {
      onRelease?.();
      return;
    }
    const id = setTimeout(() => onRelease?.(), 2500);
    return () => clearTimeout(id);
  }, [stale, answered, gone, snoozedDone, server.loading, onRelease]);

  const state: ReceiptViewState = receipt.state;
  return (
    <AlertScreen
      alert={alert}
      waiting={stale ? waiting + 1 : waiting}
      answered={answered}
      receiptState={state}
      botName={receipt.botName ?? alert.botName}
      onAnswer={onAnswer}
      onReceiptDone={onReceiptDone}
      onSnoozeChoose={onSnoozeChoose}
      gone={gone}
      onGoneDone={onGoneDone}
    />
  );
}

/** The dev sample route: the same screen with no backend and a fixed receipt. */
function SampleAlertHost({
  alert,
  waiting,
  onAnswer,
  onSnooze,
}: {
  alert: PendingAlert;
  waiting: number;
  onAnswer: AnswerHandler;
  onSnooze?: (until: number | null) => Promise<void>;
}) {
  const [answered, setAnswered] = useState<AnsweredView | null>(null);
  const expired = useExpired(alert.expiresAt);
  const wrapped = useCallback<AnswerHandler>(
    async (optionIds, customReply, attachments) => {
      setAnswered(answeredView(alert, optionIds, customReply?.trim() || undefined, attachments));
      try {
        await onAnswer(optionIds, customReply, attachments);
        setAnswered((view) => (view ? { ...view, sentLocally: true } : view));
      } catch (error) {
        setAnswered(null);
        throw error;
      }
    },
    [alert, onAnswer],
  );
  const gone: AlertGoneState | null =
    !answered && expired && alert.expiresAt !== undefined ? { reason: "expired", expiredAt: alert.expiresAt } : null;
  return (
    <AlertScreen
      alert={alert}
      waiting={waiting}
      answered={answered}
      // Fixed: with no backend there is nothing to wait for once the sample "sent" it.
      receiptState={answered?.sentLocally ? "delivered" : "sending"}
      botName={alert.botName}
      onAnswer={wrapped}
      onReceiptDone={noop}
      onSnoozeChoose={onSnooze ?? (async () => {})}
      gone={gone}
      onGoneDone={noop}
      sample
    />
  );
}

function noop() {}

/* ----------------------------------------------------------------- the screen */

interface AlertScreenProps {
  alert: PendingAlert;
  /** Alerts waiting, this one included. */
  waiting: number;
  answered: AnsweredView | null;
  receiptState: ReceiptViewState;
  botName: string;
  onAnswer: AnswerHandler;
  onReceiptDone: () => void;
  onSnoozeChoose: (until: number | null) => Promise<void>;
  gone: AlertGoneState | null;
  onGoneDone: () => void;
  sample?: boolean;
}

function AlertScreen({
  alert,
  waiting,
  answered,
  receiptState,
  botName,
  onAnswer,
  onReceiptDone,
  onSnoozeChoose,
  gone,
  onGoneDone,
  sample,
}: AlertScreenProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const openReply = useCallback(() => setReplyOpen(true), []);
  const openSnooze = useCallback(() => setSnoozeOpen(true), []);
  const { botId, botName: alertBotName } = alert;
  const bot = useMemo(() => botLook({ botId, botName: alertBotName }), [botId, alertBotName]);
  // Over the lock screen the A9 card closes by itself, so it never holds the lock screen.
  const goneAutoCloseMs = gone && isLocked() === true ? GONE_LOCKED_CLOSE_MS : undefined;
  return (
    <>
      <AlertBody
        alert={alert}
        waiting={waiting}
        onAnswer={onAnswer}
        onReply={openReply}
        onSnooze={openSnooze}
        receipt={
          answered ? (
            <A7Receipt
              bot={bot}
              answerLabels={answered.labels}
              {...(answered.reply ? { reply: answered.reply } : {})}
              {...(answered.attachments ? { attachments: answered.attachments } : {})}
              state={receiptState}
              botName={botName}
              onDone={onReceiptDone}
            />
          ) : undefined
        }
        gone={
          gone ? (
            <A9Gone
              bot={bot}
              reason={gone.reason}
              {...(gone.clientName ? { clientName: gone.clientName } : {})}
              {...(gone.answerLabels ? { answerLabels: gone.answerLabels } : {})}
              {...(gone.expiredAt !== undefined ? { expiredAt: gone.expiredAt } : {})}
              {...(goneAutoCloseMs !== undefined ? { autoCloseMs: goneAutoCloseMs } : {})}
              onDone={onGoneDone}
            />
          ) : undefined
        }
      />
      <A5Reply
        visible={replyOpen}
        onClose={() => setReplyOpen(false)}
        alert={alert}
        onSend={async (optionIds, customReply, attachments) => {
          await onAnswer(optionIds, customReply, attachments);
          setReplyOpen(false);
        }}
        getUploadUrl={sample ? () => Promise.reject(new Error("Uploads need a real alert")) : undefined}
      />
      <A11Snooze visible={snoozeOpen} onClose={() => setSnoozeOpen(false)} bot={bot} onChoose={onSnoozeChoose} />
    </>
  );
}

function AlertBody({
  alert,
  waiting,
  onAnswer,
  onReply,
  onSnooze,
  receipt,
  gone,
}: {
  alert: PendingAlert;
  /** Alerts waiting, this one included (the "1 of 3" counter). */
  waiting: number;
  onAnswer: AnswerHandler;
  onReply: () => void;
  onSnooze: () => void;
  receipt: ReactNode;
  gone: ReactNode;
}) {
  // Urgent over the lock screen: the clock, and the night look from 10 PM to 7 AM (card T34).
  const look = useUrgentLook(alert.priority);
  const readingAloud = useReadingAloud(alert.questionId);
  const frame = { night: look.night, clock: look.clock, readingAloud, receipt, gone };
  if (alert.selectionMode === "single" && alert.presentation === "choice") {
    return <A1ChoiceSingle alert={alert} waiting={waiting} onAnswer={onAnswer} onReply={onReply} onSnooze={onSnooze} {...frame} />;
  }
  if (alert.selectionMode === "multi" && alert.presentation === "choice") {
    return <A2ChoiceMulti alert={alert} waiting={waiting} onAnswer={onAnswer} onReply={onReply} onSnooze={onSnooze} {...frame} />;
  }
  if (alert.presentation === "swipe") {
    return <A3Swipe alert={alert} waiting={waiting} onAnswer={onAnswer} onReply={onReply} onSnooze={onSnooze} {...frame} />;
  }
  // The POC screens record the answer themselves and ignore `onAnswer`. Nothing reaches them now
  // that A1, A2 and A3 cover every alert; the old screens stay until the old Inbox is replaced.
  return <ChoiceScreen alert={alert} waiting={waiting} />;
}
