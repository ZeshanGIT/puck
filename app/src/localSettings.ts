/**
 * Settings that live on the phone, not in Convex (Protocol changes section 6, Q6), and the small
 * pure rules the urgent alert uses: whether it may ring through Do Not Disturb or silent mode,
 * how long it rings, when the screen uses the night look, and how the lock-screen clock reads.
 *
 * This file holds only what the urgent alert needs today. The Settings screens (a later card)
 * extend it: the shapes below already carry the per-bot overrides and the default ring length.
 * Nothing here imports React Native, so the rules can be unit-tested. Storage is loaded lazily.
 */

/* ----------------------------------------------------------------- settings */

/** Q6: each global setting is Off, Urgent only, or All alerts. */
export type BypassMode = "off" | "urgent" | "all";

export type AlertPriority = "normal" | "urgent";

/** Q6: a bot can override either global setting, in either direction. */
export interface BotBypass {
  dnd?: BypassMode;
  silent?: BypassMode;
}

export interface LocalSettings {
  /** Allow bots to bypass Do Not Disturb. Default: urgent only. */
  bypassDnd: BypassMode;
  /** Allow bots to bypass silent mode. Default: urgent only. */
  bypassSilent: BypassMode;
  /** Default ring length in seconds for urgent alerts; an alert's own `ringSeconds` wins (Q3). */
  ringSeconds: number;
  /** Per-bot overrides, keyed by bot id. */
  bots: Record<string, BotBypass>;
}

/** Q3: urgent alerts ring for 60 seconds unless the alert says otherwise. */
export const DEFAULT_RING_SECONDS = 60;
/** Same bounds as `ringSeconds` validation on `POST /alerts` (`@puck/shared`). */
export const RING_SECONDS_MIN = 5;
export const RING_SECONDS_MAX = 600;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  bypassDnd: "urgent",
  bypassSilent: "urgent",
  ringSeconds: DEFAULT_RING_SECONDS,
  bots: {},
};

export function isBypassMode(value: unknown): value is BypassMode {
  return value === "off" || value === "urgent" || value === "all";
}

export function isRingSeconds(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= RING_SECONDS_MIN && value <= RING_SECONDS_MAX
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
      if (entry.dnd !== undefined || entry.silent !== undefined) bots[botId] = entry;
    }
  }
  return {
    bypassDnd: isBypassMode(record.bypassDnd) ? record.bypassDnd : defaults.bypassDnd,
    bypassSilent: isBypassMode(record.bypassSilent) ? record.bypassSilent : defaults.bypassSilent,
    ringSeconds: isRingSeconds(record.ringSeconds) ? record.ringSeconds : defaults.ringSeconds,
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

/** Merges a change into the stored settings. The Settings screens call this. */
export async function saveLocalSettings(change: Partial<LocalSettings>): Promise<LocalSettings> {
  const next = parseLocalSettings(JSON.stringify({ ...(await loadLocalSettings()), ...change }));
  const SecureStore = await import("expo-secure-store");
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/* ------------------------------------------------------------------- bypass */

function modeAllows(mode: BypassMode, priority: AlertPriority): boolean {
  if (mode === "off") return false;
  if (mode === "urgent") return priority === "urgent";
  return true;
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

/** The alert's own `ringSeconds` wins over the default ring length (Q3). */
export function ringSecondsFor(alertRingSeconds: number | undefined, settings: LocalSettings): number {
  if (isRingSeconds(alertRingSeconds)) return alertRingSeconds;
  return isRingSeconds(settings.ringSeconds) ? settings.ringSeconds : DEFAULT_RING_SECONDS;
}

/* ----------------------------------------------------------------- channels */

/**
 * An Android channel's sound, bypass and audio stream are fixed once it exists, so every
 * combination has its own channel. `plain` keeps the POC's id and sound (`PUSH_URGENT_CHANNEL_ID`).
 */
export const URGENT_CHANNEL = {
  /** Notification sound, respects Do Not Disturb and silent mode. The POC's channel. */
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
export function urgentChannelId(decision: BypassDecision, alarmChannels: boolean): string {
  const silent = decision.silent && alarmChannels;
  if (silent) return decision.dnd ? URGENT_CHANNEL.bypass : URGENT_CHANNEL.alarm;
  return decision.dnd ? URGENT_CHANNEL.dnd : URGENT_CHANNEL.plain;
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
