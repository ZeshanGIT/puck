import notifee, {
  AlarmType,
  AndroidImportance,
  AndroidVisibility,
  EventType,
  TriggerType,
  type Event,
} from "@notifee/react-native";
import { alertRingingPlan } from "./alertRinging";
import {
  canCreateRingChannel,
  canDrawOverlay,
  createRingChannel,
  hideOverlayCard,
  hasDndAccess,
  isAppInForeground,
  isInCall,
  isLocked,
  isScreenOn,
  openAlertFullScreen,
  setOverlayChoices,
  showOverlayCard,
  soundPolicy,
  startRing,
  stopRing,
} from "puck-full-screen";
import { useEffect, useState } from "react";
import { dismissedQuestionId } from "./dismissPayload";
import { fullscreenAlert, type FullScreenAlert } from "./fullscreenPayload";
import { puckRing } from "./ringPlayback";
import { fetchCardChoices } from "./cardAnswerBackend";
import {
  cardChannelId,
  isNight,
  fullScreenFor,
  loadLocalSettings,
  loopsFor,
  reminderMinutesFor,
  ringtoneFor,
  URGENT_CHANNEL,
  normalChannelId,
  urgentChannelId,
  type AlertPriority,
  type BypassDecision,
  type LocalSettings,
} from "./localSettings";
import { handleLivePush } from "./liveNotification";
import { allReminderIds, reminderId, reminderTimes } from "./reminders";
import { ringChannelId } from "./ringChannels";
import { systemIsDark } from "./overlayCard";
import {
  inUsePresentation,
  overlayBotLook,
  overlayCardText,
  overlayPalette,
  type InUsePresentation,
} from "./overlayCardModel";
import { botLook } from "./ui/botLook";
import { loadBotLooks } from "./ui/botLookStore";
import { livePush } from "./livePayload";
import { openPairingFromNotificationData } from "./pairingOpen";
import { displayPairing } from "./pairingDisplay";
import { pairingPush } from "./pairingPayload";
import { speechText, startSpeaking } from "./speak";
import { themeIsDark } from "./ui/themePreference";

/**
 * A full-screen alert on the phone (A4). Normal and urgent alerts each play the ringtone the person
 * chose for them (a bot can have its own), through to its end: the channel plays it, on the ring
 * volume, or on the alarm stream for an urgent alert that bypasses silent mode. It plays once
 * unless the person turned on repeating for that kind of alert, which loops it until the ring time is up. Answering,
 * swiping it away or a volume key stops it sooner. After `ringSeconds` (or when it is silenced) a
 * quiet copy takes its place in the shade, and the alert screen itself stays up.
 *
 * An alert that nobody answers can remind (urgent ones by default): it rings again every few minutes (`reminders.ts`,
 * the person's choice, per bot), as notifications scheduled with Android, so they come even when
 * the app is closed. Answering, snoozing or dismissing the alert cancels them.
 *
 * Which channel it rings on follows the alert's flags and the local settings (Q6, `bypassDecision`):
 * a channel's sound and Do Not Disturb setting are fixed once created, so each decision and each
 * ringtone has one (`ringChannels.ts`).
 * During a phone call there is only a short vibration; the alert rings when the call ends (Q18).
 */

/** After `ringSeconds` the ringing notification is replaced by the quiet copy, a moment after the card and voice stop. */
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
  /** The notification rings silently: Puck plays the ringtone itself, or silent mode or Do Not Disturb holds it back. */
  quiet: boolean;
}

const rings = new Map<string, Ring>();
const afterCall = new Map<string, { alert: FullScreenAlert; since: number }>();
let callTimer: ReturnType<typeof setInterval> | null = null;
// Clear invalidates work immediately, while the queue orders native side effects per alert.
const revisions = new Map<string, number>();
const effects = new Map<string, Promise<void>>();
function revision(id: string): number { return revisions.get(id) ?? 0; }
function serialize(id: string, work: () => Promise<void>): Promise<void> {
  const previous = effects.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  effects.set(id, next);
  void next.finally(() => { if (effects.get(id) === next) effects.delete(id); }).catch(() => {});
  return next;
}

/* ----------------------------------------------------------------- channels */

/**
 * How this alert shows on a phone in use: the compact card, the whole screen (the person's choice
 * for this kind of alert or this bot), or neither. The ring's channel must be chosen before the
 * notification is posted: either one means a quiet-banner channel, so no heads-up covers it.
 */
function inUseWanted(settings: LocalSettings, alert: FullScreenAlert): InUsePresentation {
  return inUsePresentation(
    {
      locked: isLocked(),
      allowed: canDrawOverlay(),
      inCall: false,
      appOpen: isAppInForeground(),
      screenOn: isScreenOn(),
    },
    fullScreenFor(settings, alert.priority, alert.botId),
  );
}

/** A normal alert's plain ringing channel: no bypass. */
function ensureNormalChannel(card: boolean, ringtone: string): Promise<string> {
  return ensureChannel("normal", { dnd: false, silent: false }, card, ringtone);
}

/**
 * The ringing channel for this kind of alert and bypass decision: `puck-alerts...` for normal
 * alerts, `puck-urgent...` for urgent ones, through Do Not Disturb and on the alarm stream (through
 * silent mode) as the decision says.
 */
async function ensureChannel(
  priority: AlertPriority,
  decision: BypassDecision,
  card: boolean,
  ringtone: string,
  quiet = false,
): Promise<string> {
  if (quiet) return ensureQuietChannel(priority, decision, card);
  const alarm = decision.silent && canCreateRingChannel();
  const base =
    priority === "urgent" ? urgentChannelId(decision, alarm, card) : normalChannelId(decision, alarm, card);
  const id = ringChannelId(base, ringtone);
  const kind = priority === "urgent" ? "Urgent alerts" : "Alerts";
  const name = alarm
    ? decision.dnd
      ? `${kind} (alarm, Do Not Disturb)`
      : `${kind} (alarm)`
    : decision.dnd
      ? `${kind} (Do Not Disturb)`
      : kind;
  const channelName = card ? `${name}, on the card` : name;
  if (
    canCreateRingChannel() &&
    createRingChannel(id, channelName, ringtone, alarm ? "alarm" : "ring", decision.dnd, !card)
  ) {
    return id;
  }
  // The native channel failed: ring on the notification stream instead.
  if (alarm) return ensureChannel(priority, { ...decision, silent: false }, card, ringtone);
  await notifee.createChannel({
    id,
    name: channelName,
    importance: card ? AndroidImportance.DEFAULT : AndroidImportance.HIGH,
    // Notifee is silent unless this is set. "default" is the system notification sound.
    sound: "default",
    vibration: true,
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: decision.dnd,
  });
  return id;
}

/**
 * The same channel without a sound, for an alert whose ringtone Puck plays itself (or that silent
 * mode or Do Not Disturb holds back): a notification sound would be cut off by any other app's
 * notification, so the notification only shows and vibrates. It still lets the alert through Do
 * Not Disturb when the decision says so, so it shows there.
 */
async function ensureQuietChannel(priority: AlertPriority, decision: BypassDecision, card: boolean): Promise<string> {
  const base = priority === "urgent" ? urgentChannelId(decision, false, card) : normalChannelId(decision, false, card);
  const id = `${base}-quiet`;
  const kind = priority === "urgent" ? "Urgent alerts" : "Alerts";
  const name = `${kind}${decision.dnd ? " (Do Not Disturb)" : ""}${card ? ", on the card" : ""}, Puck rings`;
  await notifee.createChannel({
    id,
    name,
    importance: card ? AndroidImportance.DEFAULT : AndroidImportance.HIGH,
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

/**
 * `loopMs` is set when the person asked for the ringtone to repeat: Android then repeats the
 * channel's sound until the notification is cancelled, and it cancels it after `loopMs`, even with
 * no JavaScript running. Without it the ringtone plays once.
 */
async function postRinging(alert: FullScreenAlert, channelId: string, loopMs: number | null): Promise<void> {
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
      ...(loopMs !== null ? { loopSound: true, timeoutAfter: loopMs } : {}),
    },
  });
}

/* ---------------------------------------------------------------- reminders */

/** Cancels every reminder an alert has, scheduled or already showing. */
async function cancelReminders(questionId: string): Promise<void> {
  await Promise.all(
    allReminderIds(questionId).map(async (id) => {
      try {
        await notifee.cancelNotification(id);
      } catch {
        // Not scheduled, or already gone.
      }
    }),
  );
}

/**
 * Schedules the reminders for an alert that is ringing now (urgent: every 5 minutes by default; normal: off by default). They are Android's own scheduled
 * notifications (so they come with the app closed), each on the alert's ringing channel with no
 * full screen, and each clears itself when the next arrives.
 */
async function scheduleReminders(
  alert: FullScreenAlert,
  settings: LocalSettings,
  decision: BypassDecision,
  ringtone: string,
): Promise<void> {
  await cancelReminders(alert.questionId);
  const minutes = reminderMinutesFor(settings, alert.botId, alert.priority);
  const times = reminderTimes(Date.now(), minutes);
  if (times.length === 0) return;
  const channelId = await ensureChannel(alert.priority, decision, false, ringtone);
  for (const [index, timestamp] of times.entries()) {
    await notifee.createTriggerNotification(
      {
        id: reminderId(alert.questionId, index + 1),
        title: alert.botName,
        subtitle: "Still waiting",
        body: alert.question,
        data: { questionId: alert.questionId },
        android: {
          channelId,
          pressAction: { id: "default" },
          visibility: AndroidVisibility.PUBLIC,
          timeoutAfter: minutes * 60_000,
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp,
        // Inexact, so it needs no special permission, and it still comes while the phone dozes.
        alarmManager: { type: AlarmType.SET_AND_ALLOW_WHILE_IDLE },
      },
    );
  }
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
  stopRing(questionId);
  const ring = rings.get(questionId);
  if (!ring) return;
  clearTimeout(ring.timer);
  ring.stopSpeech?.();
  rings.delete(questionId);
}

/** The ring time is up, or a volume key silenced it: stop the sound and the voice, keep the alert. */
async function settleNow(questionId: string, version: number): Promise<void> {
  const ring = rings.get(questionId);
  if (!ring) return;
  clearTimeout(ring.timer);
  ring.stopSpeech?.();
  ring.stopSpeech = null;
  stopRing(questionId);
  if (ring.state !== "ringing") {
    // Swiped or tapped away already: nothing is left to quiet.
    if (ring.state === "gone") rings.delete(questionId);
    return;
  }
  ring.state = "quiet";
  try {
    const channelId = await ensureWaitingChannel();
    // Answered while the quiet copy was being made: do not put it back.
    if (rings.get(questionId) !== ring || revision(questionId) !== version) return;
    await postQuiet(ring.alert, channelId);
  } catch {
    // The ring has stopped. A missing shade copy is not worth failing for.
  }
}

function settle(questionId: string): Promise<void> {
  const version = revision(questionId);
  return serialize(questionId, () => settleNow(questionId, version));
}

async function startRinging(alert: FullScreenAlert, settings: LocalSettings, version: number): Promise<void> {
  const plan = alertRingingPlan(alert, settings, alert.botId, canCreateRingChannel());
  const seconds = plan.ringSeconds;
  const ringtone = ringtoneFor(settings, alert.botId, alert.priority);
  const presentation = inUseWanted(settings, alert);
  // Puck shows this alert itself (card or full screen), so the ring uses the quiet-banner channels.
  const card = presentation !== "none";
  // Do Not Disturb access is what lets the channel override it; without it the alert rings normally.
  const decision: BypassDecision = {
    dnd: plan.bypassDndOnChannel && hasDndAccess() === true,
    silent: plan.useAlarmChannel,
  };
  const loopMs = loopsFor(settings, alert.priority, alert.botId) ? seconds * 1000 : null;
  forget(alert.questionId);
  // A soft cue from a call may still be up. Post fresh so the screen and sound start again.
  await notifee.cancelNotification(alert.questionId, alert.questionId);
  if (revision(alert.questionId) !== version) return;
  // Puck rings itself, so another app's notification sound cannot cut the ringtone off; the
  // notification is then silent. Silent mode and Do Not Disturb are applied here, as Android did
  // for the notification. On an older build, or if Android refuses, the notification rings as before.
  const policy = soundPolicy();
  let quiet = false;
  if (policy) {
    const now = puckRing(decision, policy);
    quiet = !now.play || startRing(alert.questionId, ringtone, now.stream === "alarm", loopMs, alert.botName);
  }
  const channelId = await ensureChannel(alert.priority, decision, card, ringtone, quiet);
  if (revision(alert.questionId) !== version) {
    stopRing(alert.questionId);
    return;
  }
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
    quiet,
  };
  rings.set(alert.questionId, ring);
  await postRinging(alert, channelId, quiet ? null : loopMs);
  if (revision(alert.questionId) === version) {
    try {
      await scheduleReminders(alert, settings, decision, ringtone);
    } catch {
      // The alert has rung. Missing reminders are not worth failing it for.
    }
  }
  if (revision(alert.questionId) !== version) return;
  // Full screen while in use: Puck brings its alert to the front over the app in use (allowed by the
  // same permission as the card). If Android refuses, the card shows instead.
  if (presentation === "fullScreen" && openAlertFullScreen(alert.questionId)) return;
  if (card) await showCard(alert, settings, version);
}

/** On an unlocked phone the alert also shows as a compact card over other apps (when allowed). */
async function showCard(alert: FullScreenAlert, settings: LocalSettings, version: number): Promise<void> {
  const dark = themeIsDark(settings.theme, await systemIsDark());
  const plan = alertRingingPlan(alert, settings, alert.botId, canCreateRingChannel());
  await loadBotLooks();
  if (revision(alert.questionId) !== version) return;
  const bot = botLook({ botId: alert.botId ?? alert.botName, botName: alert.botName });
  const shown = await showOverlayCard({
    questionId: alert.questionId,
    ...overlayCardText(alert),
    ...overlayPalette(dark, alert.priority),
    ...overlayBotLook(bot, dark),
  });
  if (shown) {
    // The push does not carry the answers: fetch them for the card's swipe up (with Puck closed too).
    void fetchCardChoices(alert.questionId).then((choices) => {
      if (choices && revision(alert.questionId) === version) setOverlayChoices(alert.questionId, choices);
    });
  }
  // A refused card leaves only the notification, which is hard to tell from "no card was tried".
  if (!shown && revision(alert.questionId) === version) {
    // A denied or refused overlay must retain a visible heads-up fallback.
    const ringtone = ringtoneFor(settings, alert.botId, alert.priority);
    // Puck already rings it (or it is held back): the heads-up comes without a second sound.
    const quiet = rings.get(alert.questionId)?.quiet === true;
    const fallback = await ensureChannel(alert.priority, { dnd: false, silent: false }, false, ringtone, quiet);
    if (revision(alert.questionId) === version) {
      await postRinging(alert, fallback, !quiet && loopsFor(settings, alert.priority, alert.botId) ? plan.ringSeconds * 1000 : null);
    }
  }
}

/** The card was dismissed or snoozed: stop this alert's voice and quiet its ring, keeping it in the shade. */
export function silenceCardAlert(questionId: string): Promise<void> {
  // Dismissing or snoozing from the card ends the reminders too.
  void cancelReminders(questionId);
  return settle(questionId);
}

/** Swiped down on the card ("later"): quiet the ring and the voice; the alert waits, and its reminders still come. */
export function laterCardAlert(questionId: string): Promise<void> {
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
    const waiting = [...afterCall.values()].map((entry) => ({ ...entry, version: revision(entry.alert.questionId) }));
    afterCall.clear();
    stopWatchingForCallEnd();
    void loadLocalSettings().then((settings) => {
      for (const entry of waiting) {
        void serialize(entry.alert.questionId, () => startRinging(entry.alert, settings, entry.version)).catch(() => {});
      }
    });
  }, CALL_POLL_MS);
}

function stopWatchingForCallEnd(): void {
  if (callTimer === null) return;
  clearInterval(callTimer);
  callTimer = null;
}

/* ------------------------------------------------------------------- public */

export function displayUrgent(alert: FullScreenAlert): Promise<void> {
  const version = revision(alert.questionId);
  return serialize(alert.questionId, async () => {
    if (revision(alert.questionId) !== version) return;
    if (isInCall()) {
      await softCue(alert);
      if (revision(alert.questionId) !== version) return;
      afterCall.set(alert.questionId, { alert, since: Date.now() });
      watchForCallEnd();
      return;
    }
    const settings = await loadLocalSettings();
    if (revision(alert.questionId) === version) await startRinging(alert, settings, version);
  });
}

/**
 * Called when the alert is answered or dropped: stops the ring and the voice, forgets a pending
 * ring after a call, and removes the shade copy. The id and the tag are both the question id.
 */
export function clearDisplayedAlert(questionId: string): Promise<void> {
  revisions.set(questionId, revision(questionId) + 1);
  forget(questionId);
  afterCall.delete(questionId);
  return serialize(questionId, async () => {
    forget(questionId);
    afterCall.delete(questionId);
    try { await notifee.cancelNotification(questionId, questionId); } catch { /* already gone */ }
    await cancelReminders(questionId);
  });
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
    // Swiping the alert (or a reminder) away ends the reminders.
    await cancelReminders(questionId);
  } else if (event.type === EventType.PRESS) {
    const ring = rings.get(questionId);
    // Tapping cancels the notification and so its sound, and stops the ringtone Puck plays. The
    // voice carries on until the ring time.
    stopRing(questionId);
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
