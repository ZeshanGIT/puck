import notifee, { AndroidImportance, AndroidVisibility, EventType, type Event } from "@notifee/react-native";
import { PUSH_CHANNEL_ID } from "@puck/shared";
import { alertRingingPlan } from "./alertRinging";
import {
  canCreateAlarmChannel,
  canDrawOverlay,
  createAlarmChannel,
  hideOverlayCard,
  hasDndAccess,
  isInCall,
  isLocked,
  showOverlayCard,
} from "puck-full-screen";
import { useEffect, useState } from "react";
import { dismissedQuestionId } from "./dismissPayload";
import { fullscreenAlert, type FullScreenAlert } from "./fullscreenPayload";
import {
  cardChannelId,
  isNight,
  loadLocalSettings,
  ringSecondsFor,
  URGENT_CHANNEL,
  urgentChannelId,
  type BypassDecision,
  type LocalSettings,
} from "./localSettings";
import { handleLivePush } from "./liveNotification";
import { systemIsDark } from "./overlayCard";
import { overlayBotLook, overlayCardText, overlayPalette, shouldShowOverlayCard } from "./overlayCardModel";
import { botLook } from "./ui/botLook";
import { livePush } from "./livePayload";
import { openPairingFromNotificationData } from "./pairingOpen";
import { displayPairing } from "./pairingDisplay";
import { pairingPush } from "./pairingPayload";
import { speechText, startSpeaking } from "./speak";
import { themeIsDark } from "./ui/themePreference";

/**
 * A full-screen alert on the phone (A4). Urgent alerts ring insistently; normal alerts use the
 * standard alerts channel with one sound. Both may request full-screen presentation via Notifee's
 * `loopSound` sets Android's FLAG_INSISTENT, which repeats the channel's sound and vibration until
 * the notification is cancelled, and `timeoutAfter` makes Android cancel it after `ringSeconds`
 * even when no JavaScript is running. Answering, swiping it away or a volume key stops it sooner.
 * When the ring ends (or is silenced) a quiet copy takes its place in the shade, and the alert
 * screen itself stays up.
 *
 * Which channel it rings on follows the alert's flags and the local settings (Q6, `bypassDecision`):
 * a channel's sound and Do Not Disturb setting are fixed once created, so each decision has one.
 * During a phone call there is only a short vibration; the alert rings when the call ends (Q18).
 */

/** Android cancels the ringing notification at `ringSeconds`; ours is replaced a moment later. */
const QUIET_DELAY_MS = 1500;
/** How often an alert that met a phone call checks whether the call is over. */
const CALL_POLL_MS = 2000;
/** An alert that met a call is not rung for again after this long. */
const CALL_WAIT_MAX_MS = 30 * 60 * 1000;

/** "ringing": the loud notification is up. "quiet": it was replaced. "gone": swiped or tapped away. */
type RingState = "ringing" | "quiet" | "gone";

interface Ring {
  alert: FullScreenAlert;
  state: RingState;
  timer: ReturnType<typeof setTimeout>;
  stopSpeech: (() => void) | null;
}

const rings = new Map<string, Ring>();
const afterCall = new Map<string, { alert: FullScreenAlert; since: number }>();
let callTimer: ReturnType<typeof setInterval> | null = null;

/* ----------------------------------------------------------------- channels */

/**
 * Whether the compact card will show this alert. The ring's channel must be chosen before the
 * notification is posted: a card means a quiet-banner channel, so no heads-up covers the card.
 */
function overlayCardWanted(): boolean {
  return shouldShowOverlayCard({ locked: isLocked(), allowed: canDrawOverlay(), inCall: false });
}

/** Normal full-screen alerts always use the shared `puck-alerts` channel (not urgent bypass). */
async function ensureNormalChannel(card: boolean): Promise<string> {
  const id = card ? cardChannelId(PUSH_CHANNEL_ID) : PUSH_CHANNEL_ID;
  await notifee.createChannel({
    id,
    name: card ? "Alerts on the card" : "Alerts",
    importance: card ? AndroidImportance.DEFAULT : AndroidImportance.HIGH,
    sound: "default",
    vibration: true,
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: false,
  });
  return id;
}

async function ensureChannel(decision: BypassDecision, card: boolean): Promise<string> {
  const alarm = decision.silent && canCreateAlarmChannel();
  const id = urgentChannelId(decision, alarm, card);
  const label = decision.dnd ? "Urgent alerts (Do Not Disturb)" : "Urgent alerts";
  if (alarm) {
    const name = decision.dnd ? "Urgent alerts (alarm, Do Not Disturb)" : "Urgent alerts (alarm)";
    if (createAlarmChannel(id, card ? `${name}, on the card` : name, decision.dnd, !card)) return id;
    // The native channel failed: ring on the notification stream instead.
    return ensureChannel({ ...decision, silent: false }, card);
  }
  await notifee.createChannel({
    id,
    name: card ? `${label}, on the card` : label,
    importance: card ? AndroidImportance.DEFAULT : AndroidImportance.HIGH,
    // Notifee is silent unless this is set. "default" is the system ringtone.
    sound: "default",
    vibration: true,
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: decision.dnd,
  });
  return id;
}

/** A heads-up with one short vibration and no sound, for an alert that arrives during a call. */
async function ensureSoftChannel(): Promise<string> {
  await notifee.createChannel({
    id: URGENT_CHANNEL.soft,
    name: "Urgent alerts during a call",
    importance: AndroidImportance.HIGH,
    vibration: true,
    vibrationPattern: [0, 250],
    visibility: AndroidVisibility.PUBLIC,
  });
  return URGENT_CHANNEL.soft;
}

/** Where an urgent alert waits once it stops ringing: in the shade, with no sound. */
async function ensureWaitingChannel(): Promise<string> {
  await notifee.createChannel({
    id: URGENT_CHANNEL.waiting,
    name: "Urgent alerts waiting",
    importance: AndroidImportance.DEFAULT,
    vibration: false,
    visibility: AndroidVisibility.PUBLIC,
  });
  return URGENT_CHANNEL.waiting;
}

/* ------------------------------------------------------------ notifications */

async function postRinging(
  alert: FullScreenAlert,
  channelId: string,
  plan: { insistent: boolean; timeoutMs: number | undefined },
): Promise<void> {
  await notifee.displayNotification({
    id: alert.questionId,
    title: alert.botName,
    body: alert.question,
    data: { questionId: alert.questionId },
    android: {
      channelId,
      pressAction: { id: "default" },
      fullScreenAction: { id: "default" },
      visibility: AndroidVisibility.PUBLIC,
      tag: alert.questionId,
      ...(plan.insistent ? { loopSound: true } : {}),
      ...(plan.timeoutMs !== undefined ? { timeoutAfter: plan.timeoutMs } : {}),
    },
  });
}

/** The same alert without sound or the full screen. Replaces whatever is in the shade for it. */
async function postQuiet(alert: FullScreenAlert, channelId: string): Promise<void> {
  await notifee.cancelNotification(alert.questionId, alert.questionId);
  await notifee.displayNotification({
    id: alert.questionId,
    title: alert.botName,
    body: alert.question,
    data: { questionId: alert.questionId },
    android: {
      channelId,
      pressAction: { id: "default" },
      visibility: AndroidVisibility.PUBLIC,
      tag: alert.questionId,
      onlyAlertOnce: true,
    },
  });
}

/* ------------------------------------------------------------------ ringing */

function forget(questionId: string): void {
  hideOverlayCard(questionId);
  const ring = rings.get(questionId);
  if (!ring) return;
  clearTimeout(ring.timer);
  ring.stopSpeech?.();
  rings.delete(questionId);
}

/** The ring time is up, or a volume key silenced it: stop the sound and the voice, keep the alert. */
async function settle(questionId: string): Promise<void> {
  const ring = rings.get(questionId);
  if (!ring) return;
  clearTimeout(ring.timer);
  ring.stopSpeech?.();
  ring.stopSpeech = null;
  if (ring.state !== "ringing") {
    // Swiped or tapped away already: nothing is left to quiet.
    if (ring.state === "gone") rings.delete(questionId);
    return;
  }
  ring.state = "quiet";
  try {
    const channelId = await ensureWaitingChannel();
    // Answered while the quiet copy was being made: do not put it back.
    if (rings.get(questionId) !== ring) return;
    await postQuiet(ring.alert, channelId);
  } catch {
    // The ring has stopped. A missing shade copy is not worth failing for.
  }
}

async function startRinging(alert: FullScreenAlert, settings: LocalSettings): Promise<void> {
  const plan = alertRingingPlan(alert, settings, alert.botId, canCreateAlarmChannel());
  const seconds =
    plan.timeoutMs !== undefined ? Math.max(1, Math.round(plan.timeoutMs / 1000)) : ringSecondsFor(alert.ringSeconds, settings);
  const card = overlayCardWanted();
  let channelId: string;
  if (alert.priority === "urgent") {
    // Do Not Disturb access is what lets the channel override it; without it the alert rings normally.
    const decision = {
      dnd: plan.bypassDndOnChannel && hasDndAccess() === true,
      silent: plan.useAlarmChannel,
    };
    channelId = await ensureChannel(decision, card);
  } else {
    channelId = await ensureNormalChannel(card);
  }
  forget(alert.questionId);
  // A soft cue from a call may still be up. Post fresh so the screen and sound start again.
  await notifee.cancelNotification(alert.questionId, alert.questionId);
  const ring: Ring = {
    alert,
    state: "ringing",
    timer: setTimeout(() => {
      hideOverlayCard(alert.questionId);
      void settle(alert.questionId);
    }, seconds * 1000 + QUIET_DELAY_MS),
    stopSpeech:
      alert.priority === "urgent" && alert.speak
        ? startSpeaking(alert.questionId, speechText(alert.question, alert.message), seconds)
        : null,
  };
  rings.set(alert.questionId, ring);
  await postRinging(alert, channelId, plan);
  if (card) await showCard(alert, settings);
}

/** On an unlocked phone the alert also shows as a compact card over other apps (when allowed). */
async function showCard(alert: FullScreenAlert, settings: LocalSettings): Promise<void> {
  const dark = themeIsDark(settings.theme, await systemIsDark());
  const bot = botLook({ botId: alert.botId ?? alert.botName, botName: alert.botName });
  showOverlayCard({
    questionId: alert.questionId,
    ...overlayCardText(alert),
    ...overlayPalette(dark, alert.priority),
    ...overlayBotLook(bot, dark),
  });
}

/** The card was dismissed or snoozed: stop this alert's voice and quiet its ring, keeping it in the shade. */
export function silenceCardAlert(questionId: string): Promise<void> {
  return settle(questionId);
}

/** Volume key: silence every ringing alert (and its voice) without answering. */
export function silenceRings(): void {
  for (const [questionId, ring] of rings) {
    if (ring.state === "ringing") void settle(questionId);
  }
}

/* --------------------------------------------------------------- phone call */

async function softCue(alert: FullScreenAlert): Promise<void> {
  const channelId = await ensureSoftChannel();
  await notifee.displayNotification({
    id: alert.questionId,
    title: alert.botName,
    body: alert.question,
    data: { questionId: alert.questionId },
    android: {
      channelId,
      pressAction: { id: "default" },
      visibility: AndroidVisibility.PUBLIC,
      tag: alert.questionId,
    },
  });
}

/** Polls until the call is over, then rings for every alert that is still unanswered. */
function watchForCallEnd(): void {
  if (callTimer !== null) return;
  callTimer = setInterval(() => {
    const now = Date.now();
    for (const [questionId, entry] of afterCall) {
      if (now - entry.since > CALL_WAIT_MAX_MS) afterCall.delete(questionId);
    }
    if (afterCall.size === 0) {
      stopWatchingForCallEnd();
      return;
    }
    if (isInCall()) return;
    const waiting = [...afterCall.values()];
    afterCall.clear();
    stopWatchingForCallEnd();
    void loadLocalSettings().then((settings) => {
      for (const entry of waiting) void startRinging(entry.alert, settings).catch(() => {});
    });
  }, CALL_POLL_MS);
}

function stopWatchingForCallEnd(): void {
  if (callTimer === null) return;
  clearInterval(callTimer);
  callTimer = null;
}

/* ------------------------------------------------------------------- public */

export async function displayUrgent(alert: FullScreenAlert): Promise<void> {
  if (isInCall()) {
    // Q18: no ringing and no takeover. One short vibration; the alert waits and rings after the call.
    await softCue(alert);
    afterCall.set(alert.questionId, { alert, since: Date.now() });
    watchForCallEnd();
    return;
  }
  await startRinging(alert, await loadLocalSettings());
}

/**
 * Called when the alert is answered or dropped: stops the ring and the voice, forgets a pending
 * ring after a call, and removes the shade copy. The id and the tag are both the question id.
 */
export async function clearDisplayedAlert(questionId: string): Promise<void> {
  forget(questionId);
  afterCall.delete(questionId);
  try {
    await notifee.cancelNotification(questionId, questionId);
  } catch {
    // The inbox no longer shows the alert. A leftover shade copy can be dismissed by hand.
  }
}

/** Notifee events for the urgent notification: swiping it away silences it, a tap keeps the voice. */
export async function handleNotifeeEvent(event: Event): Promise<void> {
  // A tap on a pairing request (N7) opens B4 for it (`pairingOpen.ts`).
  if (event.type === EventType.PRESS && openPairingFromNotificationData(event.detail.notification?.data)) return;
  const questionId = event.detail.notification?.data?.questionId;
  if (typeof questionId !== "string") return;
  if (event.type === EventType.DISMISSED) {
    forget(questionId);
    afterCall.delete(questionId);
  } else if (event.type === EventType.PRESS) {
    const ring = rings.get(questionId);
    // Tapping cancels the notification and so the loop. The voice carries on until the ring time.
    if (ring && ring.state === "ringing") ring.state = "gone";
  }
}

export async function handleUrgentTask(data: unknown): Promise<void> {
  // Answered or snoozed on another client: drop this phone's copy (shade, ring, voice).
  const dismissed = dismissedQuestionId(data);
  if (dismissed) {
    await clearDisplayedAlert(dismissed);
    return;
  }
  // A bot asks to pair (N7): an ordinary shade notification, not a ring.
  const pairing = pairingPush(data);
  if (pairing) {
    await displayPairing(pairing);
    return;
  }
  // A bot's running task (N8): one quiet ongoing notification, updated in place.
  const live = livePush(data);
  if (live) {
    await handleLivePush(live);
    return;
  }
  const alert = fullscreenAlert(data);
  if (!alert) return;
  await displayUrgent(alert);
}

/* --------------------------------------------------------------- the screen */

/** What the alert screen wears: the lock-screen clock, and the night look at night. */
export interface UrgentLook {
  night: boolean;
  clock: boolean;
}

function currentLook(priority: "normal" | "urgent"): UrgentLook {
  const overLockScreen = isLocked() === true;
  const urgent = priority === "urgent";
  return { night: overLockScreen && urgent && isNight(new Date()), clock: overLockScreen };
}

/**
 * A4: any full-screen alert over the lock screen shows the clock. The night look stays urgent-only.
 * Pass the result to `AlertFrame` (`night`, `clock`). Re-checks every few seconds so the look
 * follows an unlock or the clock striking 7.
 */
export function useUrgentLook(priority: "normal" | "urgent"): UrgentLook {
  const [look, setLook] = useState(() => currentLook(priority));
  useEffect(() => {
    const update = () =>
      setLook((previous) => {
        const next = currentLook(priority);
        return previous.night === next.night && previous.clock === next.clock ? previous : next;
      });
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, [priority]);
  return look;
}
