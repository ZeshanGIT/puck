/**
 * Settings that live on the phone, not in Convex (Protocol changes section 6, Q6), and the small
 * pure rules the urgent alert uses: whether it may ring through Do Not Disturb or silent mode,
 * which ringtone each kind of alert plays, how often an unanswered urgent alert reminds, when the
 * screen uses the night look, and how the lock-screen clock reads.
 *
 * This file holds only what the urgent alert needs today. The Settings screens (a later card)
 * extend it: the shapes below already carry the per-bot overrides and the default ring length.
 * Nothing here imports React Native, so the rules can be unit-tested. Storage is loaded lazily.
 */

import { DEFAULT_THEME_PREFERENCE, isThemePreference, type ThemePreference } from "./ui/themePreference";

/* ----------------------------------------------------------------- settings */

/**
 * Q6: which kinds of alert may bypass Do Not Disturb (or silent mode). The Alerts screen shows it
 * as one switch in each kind's section, so every combination is possible: off, urgent only,
 * normal only, or all. Stored as one value so earlier settings ("off", "urgent", "all") still read.
 */
export type BypassMode = "off" | "urgent" | "normal" | "all";

export type AlertPriority = "normal" | "urgent";

/** Q6: a bot can override either global setting, in either direction. It can also set its own reminder interval. */
export interface BotBypass {
  dnd?: BypassMode;
  silent?: BypassMode;
  /** Minutes between reminders for this bot's unanswered urgent alerts; 0 is off. */
  reminderMinutes?: number;
  /** The same for its normal alerts. */
  reminderMinutesNormal?: number;
  /** This bot's own ringtone for normal alerts (a URI; empty is the phone's own). Absent follows the global one. */
  normalRingtone?: string;
  /** This bot's own ringtone for urgent alerts. Absent follows the global one. */
  urgentRingtone?: string;
  /** Whether this bot's normal alerts repeat their ringtone. Absent follows the global setting. */
  loopNormal?: boolean;
  /** The same for urgent alerts. */
  loopUrgent?: boolean;
  /** Whether this bot's normal alerts take the whole screen while the phone is in use. Absent follows the global setting. */
  fullScreenNormal?: boolean;
  /** The same for urgent alerts. */
  fullScreenUrgent?: boolean;
  /** Show this bot's live tasks as a floating card over other apps. Off when absent. */
  liveFloat?: boolean;
}

export interface LocalSettings {
  /** The Appearance setting on Settings. Default: follow the system. */
  theme: ThemePreference;
  /** Allow bots to bypass Do Not Disturb. Default: urgent only. */
  bypassDnd: BypassMode;
  /** Allow bots to bypass silent mode. Default: urgent only. */
  bypassSilent: BypassMode;
  /** The ringtone normal alerts play, as a system ringtone URI. Empty: the phone's own ringtone. */
  normalRingtone: string;
  /** The ringtone urgent alerts play, as a system ringtone URI. Empty: the phone's own ringtone. */
  urgentRingtone: string;
  /** Whether a normal alert's ringtone repeats until it is answered or its ring time is up. Default: it plays once. */
  loopNormal: boolean;
  /** The same for urgent alerts. */
  loopUrgent: boolean;
  /**
   * While the phone is unlocked and in use, a normal alert takes the whole screen instead of showing
   * as the card over the app in use. Default: the card. Needs the same "Display over other apps"
   * permission as the card.
   */
  fullScreenNormal: boolean;
  /** The same for urgent alerts. */
  fullScreenUrgent: boolean;
  /** Minutes between reminders for an unanswered urgent alert; 0 is off. A bot can override it. */
  reminderMinutes: number;
  /** The same for a normal alert. Default: off. */
  reminderMinutesNormal: number;
  /** Per-bot overrides, keyed by bot id. */
  bots: Record<string, BotBypass>;
}

/**
 * How long an alert's card and spoken text stay up before the alert settles into a quiet copy in
 * the shade, unless the alert says otherwise. The ringtone itself plays once, to the end.
 */
export const DEFAULT_RING_SECONDS = 60;
/** Same bounds as `ringSeconds` validation on `POST /alerts` (`@puck/shared`). */
export const RING_SECONDS_MIN = 5;
export const RING_SECONDS_MAX = 600;

/** The reminder intervals Alert sounds offers, in minutes. 0 is off. */
export const REMINDER_CHOICES = [0, 2, 5, 10, 15] as const;
/** An unanswered urgent alert reminds every 5 minutes unless set otherwise. */
export const DEFAULT_REMINDER_MINUTES = 5;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  theme: DEFAULT_THEME_PREFERENCE,
  bypassDnd: "urgent",
  bypassSilent: "urgent",
  normalRingtone: "",
  urgentRingtone: "",
  loopNormal: false,
  loopUrgent: false,
  fullScreenNormal: false,
  fullScreenUrgent: false,
  reminderMinutes: DEFAULT_REMINDER_MINUTES,
  reminderMinutesNormal: 0,
  bots: {},
};

export function isBypassMode(value: unknown): value is BypassMode {
  return value === "off" || value === "urgent" || value === "normal" || value === "all";
}

export function isReminderMinutes(value: unknown): value is number {
  return typeof value === "number" && (REMINDER_CHOICES as readonly number[]).includes(value);
}

export function isRingSeconds(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= RING_SECONDS_MIN && value <= RING_SECONDS_MAX
  );
}

function hasOverride(entry: BotBypass): boolean {
  return (
    entry.dnd !== undefined ||
    entry.silent !== undefined ||
    entry.reminderMinutes !== undefined ||
    entry.reminderMinutesNormal !== undefined ||
    entry.normalRingtone !== undefined ||
    entry.urgentRingtone !== undefined ||
    entry.loopNormal !== undefined ||
    entry.loopUrgent !== undefined ||
    entry.fullScreenNormal !== undefined ||
    entry.fullScreenUrgent !== undefined ||
    entry.liveFloat !== undefined
  );
}

/** Reads stored settings. Anything missing or invalid falls back to the default, field by field. */
export function parseLocalSettings(raw: string | null | undefined): LocalSettings {
  const defaults = DEFAULT_LOCAL_SETTINGS;
  if (!raw) return { ...defaults, bots: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...defaults, bots: {} };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ...defaults, bots: {} };
  const record = parsed as Record<string, unknown>;
  const bots: Record<string, BotBypass> = {};
  if (typeof record.bots === "object" && record.bots !== null && !Array.isArray(record.bots)) {
    for (const [botId, value] of Object.entries(record.bots as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const override = value as Record<string, unknown>;
      const entry: BotBypass = {};
      if (isBypassMode(override.dnd)) entry.dnd = override.dnd;
      if (isBypassMode(override.silent)) entry.silent = override.silent;
      if (isReminderMinutes(override.reminderMinutes)) entry.reminderMinutes = override.reminderMinutes;
      if (isReminderMinutes(override.reminderMinutesNormal)) entry.reminderMinutesNormal = override.reminderMinutesNormal;
      if (typeof override.normalRingtone === "string") entry.normalRingtone = override.normalRingtone;
      if (typeof override.urgentRingtone === "string") entry.urgentRingtone = override.urgentRingtone;
      if (typeof override.loopNormal === "boolean") entry.loopNormal = override.loopNormal;
      if (typeof override.loopUrgent === "boolean") entry.loopUrgent = override.loopUrgent;
      if (typeof override.fullScreenNormal === "boolean") entry.fullScreenNormal = override.fullScreenNormal;
      if (typeof override.fullScreenUrgent === "boolean") entry.fullScreenUrgent = override.fullScreenUrgent;
      if (typeof override.liveFloat === "boolean") entry.liveFloat = override.liveFloat;
      if (hasOverride(entry)) bots[botId] = entry;
    }
  }
  return {
    theme: isThemePreference(record.theme) ? record.theme : defaults.theme,
    bypassDnd: isBypassMode(record.bypassDnd) ? record.bypassDnd : defaults.bypassDnd,
    bypassSilent: isBypassMode(record.bypassSilent) ? record.bypassSilent : defaults.bypassSilent,
    normalRingtone: typeof record.normalRingtone === "string" ? record.normalRingtone : defaults.normalRingtone,
    urgentRingtone: typeof record.urgentRingtone === "string" ? record.urgentRingtone : defaults.urgentRingtone,
    loopNormal: typeof record.loopNormal === "boolean" ? record.loopNormal : defaults.loopNormal,
    loopUrgent: typeof record.loopUrgent === "boolean" ? record.loopUrgent : defaults.loopUrgent,
    fullScreenNormal: typeof record.fullScreenNormal === "boolean" ? record.fullScreenNormal : defaults.fullScreenNormal,
    fullScreenUrgent: typeof record.fullScreenUrgent === "boolean" ? record.fullScreenUrgent : defaults.fullScreenUrgent,
    reminderMinutes: isReminderMinutes(record.reminderMinutes) ? record.reminderMinutes : defaults.reminderMinutes,
    reminderMinutesNormal: isReminderMinutes(record.reminderMinutesNormal)
      ? record.reminderMinutesNormal
      : defaults.reminderMinutesNormal,
    bots,
  };
}

const SETTINGS_KEY = "puck.localSettings";

/** The stored settings, or the defaults. Never throws, so a headless alert still rings. */
export async function loadLocalSettings(): Promise<LocalSettings> {
  try {
    const SecureStore = await import("expo-secure-store");
    return parseLocalSettings(await SecureStore.getItemAsync(SETTINGS_KEY));
  } catch {
    return parseLocalSettings(null);
  }
}

type SettingsListener = (settings: LocalSettings) => void;
const listeners = new Set<SettingsListener>();

/** Calls `listener` with the settings after each save, so a screen can apply a change at once. */
export function subscribeLocalSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merges a change into the stored settings. The Settings screens call this. */
export async function saveLocalSettings(change: Partial<LocalSettings>): Promise<LocalSettings> {
  const next = parseLocalSettings(JSON.stringify({ ...(await loadLocalSettings()), ...change }));
  const SecureStore = await import("expo-secure-store");
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next));
  for (const listener of listeners) listener(next);
  return next;
}

/* ------------------------------------------------------- per-bot overrides */

/** A change to one bot's overrides: a mode sets it, `null` goes back to the default, `undefined` leaves it. */
export interface BotBypassChange {
  dnd?: BypassMode | null;
  silent?: BypassMode | null;
  reminderMinutes?: number | null;
  reminderMinutesNormal?: number | null;
  /** A ringtone URI sets it (empty is the phone's own), `null` follows the global one again. */
  normalRingtone?: string | null;
  urgentRingtone?: string | null;
  /** On or off sets it for this bot, `null` follows the global setting again. */
  loopNormal?: boolean | null;
  loopUrgent?: boolean | null;
  /** Full screen or card while the phone is in use, for this bot; `null` follows the global setting again. */
  fullScreenNormal?: boolean | null;
  fullScreenUrgent?: boolean | null;
  /** The floating card for live tasks: on, or `null` (off). */
  liveFloat?: boolean | null;
}

/**
 * The settings with one bot's overrides changed (B2's "Through Do Not Disturb" and "Through silent
 * mode" chips). A bot left with no override has no entry. Pure: returns new settings.
 */
export function withBotBypass(settings: LocalSettings, botId: string, change: BotBypassChange): LocalSettings {
  const before = settings.bots[botId] ?? {};
  const next: BotBypass = { ...before };
  if (change.dnd === null) delete next.dnd;
  else if (change.dnd !== undefined) next.dnd = change.dnd;
  if (change.silent === null) delete next.silent;
  else if (change.silent !== undefined) next.silent = change.silent;
  if (change.reminderMinutes === null) delete next.reminderMinutes;
  else if (change.reminderMinutes !== undefined) next.reminderMinutes = change.reminderMinutes;
  if (change.reminderMinutesNormal === null) delete next.reminderMinutesNormal;
  else if (change.reminderMinutesNormal !== undefined) next.reminderMinutesNormal = change.reminderMinutesNormal;
  if (change.normalRingtone === null) delete next.normalRingtone;
  else if (change.normalRingtone !== undefined) next.normalRingtone = change.normalRingtone;
  if (change.urgentRingtone === null) delete next.urgentRingtone;
  else if (change.urgentRingtone !== undefined) next.urgentRingtone = change.urgentRingtone;
  if (change.loopNormal === null) delete next.loopNormal;
  else if (change.loopNormal !== undefined) next.loopNormal = change.loopNormal;
  if (change.loopUrgent === null) delete next.loopUrgent;
  else if (change.loopUrgent !== undefined) next.loopUrgent = change.loopUrgent;
  if (change.fullScreenNormal === null) delete next.fullScreenNormal;
  else if (change.fullScreenNormal !== undefined) next.fullScreenNormal = change.fullScreenNormal;
  if (change.fullScreenUrgent === null) delete next.fullScreenUrgent;
  else if (change.fullScreenUrgent !== undefined) next.fullScreenUrgent = change.fullScreenUrgent;
  if (change.liveFloat === null || change.liveFloat === false) delete next.liveFloat;
  else if (change.liveFloat !== undefined) next.liveFloat = change.liveFloat;
  const bots = { ...settings.bots };
  if (!hasOverride(next)) delete bots[botId];
  else bots[botId] = next;
  return { ...settings, bots };
}

/** The settings without one bot's overrides (the bot was removed). */
export function withoutBot(settings: LocalSettings, botId: string): LocalSettings {
  if (!(botId in settings.bots)) return settings;
  const bots = { ...settings.bots };
  delete bots[botId];
  return { ...settings, bots };
}

/** Stores a change to one bot's overrides and returns the new settings. */
export async function saveBotBypass(botId: string, change: BotBypassChange): Promise<LocalSettings> {
  return saveLocalSettings({ bots: withBotBypass(await loadLocalSettings(), botId, change).bots });
}

/** Forgets a removed bot's overrides. */
export async function forgetBotBypass(botId: string): Promise<LocalSettings> {
  return saveLocalSettings({ bots: withoutBot(await loadLocalSettings(), botId).bots });
}

/* ------------------------------------------------------------------- bypass */

/** Whether a bypass setting lets this kind of alert through. */
export function modeAllows(mode: BypassMode, priority: AlertPriority): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  return mode === priority;
}

/** The setting with one kind of alert switched on or off and the other left as it was. */
export function withModeFor(mode: BypassMode, priority: AlertPriority, on: boolean): BypassMode {
  const urgent = priority === "urgent" ? on : modeAllows(mode, "urgent");
  const normal = priority === "normal" ? on : modeAllows(mode, "normal");
  return urgent && normal ? "all" : urgent ? "urgent" : normal ? "normal" : "off";
}

export interface BypassDecision {
  /** May ring through Do Not Disturb (still needs Do Not Disturb access on the phone). */
  dnd: boolean;
  /** May ring through silent and vibrate mode. */
  silent: boolean;
}

/**
 * Q6: an alert gets past Do Not Disturb or silent mode only if it asks (`bypassDnd`,
 * `bypassSilent`) and the setting that applies (the bot's override, otherwise the global
 * setting) allows it for that priority.
 */
export function bypassDecision(
  alert: { priority: AlertPriority; bypassDnd?: boolean; bypassSilent?: boolean },
  settings: LocalSettings,
  botId?: string,
): BypassDecision {
  const override = botId === undefined ? undefined : settings.bots[botId];
  const dndMode = override?.dnd ?? settings.bypassDnd;
  const silentMode = override?.silent ?? settings.bypassSilent;
  return {
    dnd: alert.bypassDnd === true && modeAllows(dndMode, alert.priority),
    silent: alert.bypassSilent === true && modeAllows(silentMode, alert.priority),
  };
}

/** How long the alert's card and spoken text stay up: the alert's own `ringSeconds`, else the default (Q3). */
export function ringSecondsFor(alertRingSeconds: number | undefined): number {
  return isRingSeconds(alertRingSeconds) ? alertRingSeconds : DEFAULT_RING_SECONDS;
}

/** The ringtone an alert plays: the bot's own for that kind of alert, else the global one. Empty is the phone's own. */
export function ringtoneFor(settings: LocalSettings, botId: string | undefined, priority: AlertPriority): string {
  const own = botId === undefined ? undefined : settings.bots[botId];
  const botChoice = priority === "urgent" ? own?.urgentRingtone : own?.normalRingtone;
  return botChoice ?? (priority === "urgent" ? settings.urgentRingtone : settings.normalRingtone);
}

/** Whether an alert's ringtone repeats: the bot's own choice for its kind of alert, else the global one. */
export function loopsFor(settings: LocalSettings, priority: AlertPriority, botId?: string): boolean {
  const own = botId === undefined ? undefined : settings.bots[botId];
  const botChoice = priority === "urgent" ? own?.loopUrgent : own?.loopNormal;
  return botChoice ?? (priority === "urgent" ? settings.loopUrgent : settings.loopNormal);
}

/**
 * Whether an alert takes the whole screen while the phone is in use, rather than the card: the
 * bot's own choice for its kind of alert, else the global one.
 */
export function fullScreenFor(settings: LocalSettings, priority: AlertPriority, botId?: string): boolean {
  const own = botId === undefined ? undefined : settings.bots[botId];
  const botChoice = priority === "urgent" ? own?.fullScreenUrgent : own?.fullScreenNormal;
  return botChoice ?? (priority === "urgent" ? settings.fullScreenUrgent : settings.fullScreenNormal);
}

/** Every ringtone in use: the global ones and each bot's own, so a channel for any of them is kept. */
export function ringtonesInUse(settings: LocalSettings): { normal: string[]; urgent: string[] } {
  const normal = new Set([settings.normalRingtone]);
  const urgent = new Set([settings.urgentRingtone]);
  for (const bot of Object.values(settings.bots)) {
    if (bot.normalRingtone !== undefined) normal.add(bot.normalRingtone);
    if (bot.urgentRingtone !== undefined) urgent.add(bot.urgentRingtone);
  }
  return { normal: [...normal], urgent: [...urgent] };
}

/**
 * Minutes between reminders for a bot's unanswered alerts of this kind (urgent unless said): the
 * bot's own setting, else the global one. 0 is off.
 */
export function reminderMinutesFor(settings: LocalSettings, botId?: string, priority: AlertPriority = "urgent"): number {
  const own = botId === undefined ? undefined : settings.bots[botId];
  if (priority === "normal") return own?.reminderMinutesNormal ?? settings.reminderMinutesNormal;
  return own?.reminderMinutes ?? settings.reminderMinutes;
}

/**
 * A bot's Do Not Disturb (or silent mode) override with one kind of alert following the app again.
 * Null when what is left matches the app's setting entirely: the bot has no override any more.
 */
export function followAppFor(own: BypassMode | undefined, app: BypassMode, priority: AlertPriority): BypassMode | null {
  if (own === undefined) return null;
  const next = withModeFor(own, priority, modeAllows(app, priority));
  return next === app ? null : next;
}

/* ----------------------------------------------------------------- channels */

/**
 * An Android channel's sound, bypass and audio stream are fixed once it exists, so every
 * combination has its own channel, and the ringtone is part of the id (`ringChannelId`). These are
 * the ids before the ringtone is added.
 */
export const URGENT_CHANNEL = {
  /** The ring volume: respects Do Not Disturb and silent mode. */
  plain: "puck-urgent",
  /** Rings through Do Not Disturb. */
  dnd: "puck-urgent-dnd",
  /** Alarm audio stream: rings in silent mode, respects Do Not Disturb. */
  alarm: "puck-urgent-alarm",
  /** Alarm audio stream and through Do Not Disturb. */
  bypass: "puck-urgent-bypass",
  /** During a phone call (Q18): a heads-up with one short vibration and no sound. */
  soft: "puck-urgent-soft",
  /** After the ring ends or is silenced: the alert waits in the shade, quietly. */
  waiting: "puck-urgent-waiting",
} as const;

/**
 * The ringing channel for a decision. `silent` only counts when the build can create alarm
 * channels (the native function); otherwise the alert still rings, just not in silent mode.
 */
export function urgentChannelId(decision: BypassDecision, alarmChannels: boolean, card = false): string {
  const silent = decision.silent && alarmChannels;
  const id = silent
    ? decision.dnd
      ? URGENT_CHANNEL.bypass
      : URGENT_CHANNEL.alarm
    : decision.dnd
      ? URGENT_CHANNEL.dnd
      : URGENT_CHANNEL.plain;
  return card ? cardChannelId(id) : id;
}

/**
 * The ringing channel for a normal alert: `puck-alerts`, or its variants through Do Not Disturb, on
 * the alarm stream (through silent mode) or both, when the alert asked and the settings allow it.
 */
export function normalChannelId(decision: BypassDecision, alarmChannels: boolean, card = false): string {
  const silent = decision.silent && alarmChannels;
  const suffix = silent ? (decision.dnd ? "-bypass" : "-alarm") : decision.dnd ? "-dnd" : "";
  const id = `${NORMAL_CHANNEL_BASE}${suffix}`;
  return card ? cardChannelId(id) : id;
}

/** `PUSH_CHANNEL_ID` in `@puck/shared`; repeated here so this file stays free of imports. */
export const NORMAL_CHANNEL_BASE = "puck-alerts";

/**
 * The same channel as `base`, but without a heads-up banner: used when the compact card shows the
 * alert, so the banner cannot cover the card. The sound and the stream stay as they are.
 */
export function cardChannelId(base: string): string {
  return `${base}-card`;
}

/* -------------------------------------------------------------------- night */

/** A4: the night look runs from 10 PM to 7 AM, local time. */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 7;

export function isNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/* -------------------------------------------------------------------- clock */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The prototype's lock clock: 24-hour, no leading zero on the hour ("6:00", "21:47"). */
export function clockText(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The prototype's lock date ("Saturday, 7 November"). */
export function clockDateText(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Whether this bot's live tasks float over other apps (its page in Bots). Off unless turned on. */
export function liveFloatFor(settings: Pick<LocalSettings, "bots">, botId: string): boolean {
  return settings.bots[botId]?.liveFloat === true;
}
