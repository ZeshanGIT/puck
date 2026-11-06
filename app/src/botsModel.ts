/**
 * The logic behind the Bots screens (B1 the list, B2 a bot): the mute chips and the time each one
 * stores as `mutedUntil`, the words ("Muted until 7:00", "Last paged 3 min ago"), the order of the
 * list, and the chips for the per-bot Do Not Disturb and silent-mode overrides. Plain TypeScript, no
 * React, so it can be tested.
 */
import type { KnownBot } from "./homeModel";
import { clockText, type BotBypass, type BypassMode } from "./localSettings";
import { requestedColour } from "./pairingModel";
import type { BlobBot } from "./ui/blobShapes";
import { botLook } from "./ui/botLook";

/** One bot, as `bots.list` returns it. */
export interface BotListItem {
  botId: string;
  name: string;
  /** The palette name, or null when the bot never had one. */
  colour: string | null;
  /** Epoch ms the mute ends, or null. */
  mutedUntil: number | null;
  createdAt: number;
  addedFrom: string | null;
  lastAlertAt: number | null;
  waitingCount: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ---------------------------------------------------------------------- mute */

export type MuteChoice = "off" | "1h" | "tomorrow" | "week";

/** The mute chips, in order, with the ids used for `testID` (`mute-<id>`). "Off" unmutes. */
export const MUTE_CHIPS: readonly { id: MuteChoice; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "1h", label: "For 1 hour" },
  { id: "tomorrow", label: "Until tomorrow" },
  { id: "week", label: "For a week" },
];

/** The hour "Until tomorrow" ends: the next 7:00 AM, local time. */
export const MORNING_HOUR = 7;

/** The next 7:00 AM after `now` (today's if it is before 7:00, otherwise tomorrow's). */
export function nextMorning(now: number): number {
  const date = new Date(now);
  const morning = new Date(date.getFullYear(), date.getMonth(), date.getDate(), MORNING_HOUR, 0, 0, 0);
  if (morning.getTime() <= now) morning.setDate(morning.getDate() + 1);
  return morning.getTime();
}

/** The `mutedUntil` a chip stores: a time in the future, or null for Off. */
export function muteUntil(choice: MuteChoice, now: number): number | null {
  switch (choice) {
    case "off":
      return null;
    case "1h":
      return now + HOUR;
    case "tomorrow":
      return nextMorning(now);
    case "week":
      return now + 7 * DAY;
  }
}

/** True while the mute is in force. */
export function isMuted(mutedUntil: number | null, now: number): boolean {
  return mutedUntil !== null && mutedUntil > now;
}

/**
 * The chip to show as selected for a stored `mutedUntil`. The choice itself is not stored, so it is
 * read back from the time: exactly 7:00 is "Until tomorrow", within an hour is "For 1 hour", anything
 * else is "For a week". Not muted (or the mute is over) is Off.
 */
export function selectedMuteChip(mutedUntil: number | null, now: number): MuteChoice {
  if (!isMuted(mutedUntil, now) || mutedUntil === null) return "off";
  const at = new Date(mutedUntil);
  if (at.getHours() === MORNING_HOUR && at.getMinutes() === 0 && at.getSeconds() === 0) return "tomorrow";
  return mutedUntil - now <= HOUR + MINUTE ? "1h" : "week";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

/** "Muted until 7:00" today, "Muted until tomorrow 7:00", or "Muted until 14 Nov 7:00"; null when not muted. */
export function mutedLabel(mutedUntil: number | null, now: number): string | null {
  if (!isMuted(mutedUntil, now) || mutedUntil === null) return null;
  const at = new Date(mutedUntil);
  const days = dayNumber(at) - dayNumber(new Date(now));
  const time = clockText(at);
  if (days <= 0) return `Muted until ${time}`;
  if (days === 1) return `Muted until tomorrow ${time}`;
  return `Muted until ${at.getDate()} ${MONTHS[at.getMonth()]} ${time}`;
}

/* ---------------------------------------------------------------------- words */

/** "Last paged 3 min ago", or "Hasn't paged you yet". */
export function lastPagedText(lastAlertAt: number | null, now: number): string {
  if (lastAlertAt === null) return "Hasn't paged you yet";
  const ms = Math.max(0, now - lastAlertAt);
  if (ms < MINUTE) return "Last paged just now";
  if (ms < HOUR) return `Last paged ${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `Last paged ${Math.floor(ms / HOUR)} h ago`;
  return `Last paged ${Math.floor(ms / DAY)} d ago`;
}

/** The tag on a list row: "2 waiting", or null for none. */
export function waitingTag(waitingCount: number): string | null {
  return waitingCount > 0 ? `${waitingCount} waiting` : null;
}

/** "7 Nov 2026". */
export function dateText(at: number): string {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The id for a row's `testID`: `bot-row-<name>` with the name lower-cased and spaces turned into dashes. */
export function botTestId(prefix: string, name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return `${prefix}-${slug}`;
}

/* ----------------------------------------------------------------------- list */

/**
 * The order of the list: bots with alerts waiting first (most first), then the one that paged him
 * most recently, bots that never paged him last, and by name when all else is equal.
 */
export function sortBots(bots: readonly BotListItem[]): BotListItem[] {
  return [...bots].sort(
    (a, b) =>
      b.waitingCount - a.waitingCount ||
      (b.lastAlertAt ?? -1) - (a.lastAlertAt ?? -1) ||
      a.name.localeCompare(b.name) ||
      a.botId.localeCompare(b.botId),
  );
}

/** How a bot looks: its own colour, else the one derived from its id. */
export function botBlob(bot: Pick<BotListItem, "botId" | "name" | "colour">): BlobBot {
  const colour = requestedColour(bot.colour);
  return botLook({ botId: bot.botId, botName: bot.name, ...(colour === null ? {} : { colour }) });
}

/* ------------------------------------------------------------------- bypass */

/** A chip of "Through Do Not Disturb" or "Through silent mode": the bot's own choice, or its default. */
export type BypassChoice = "default" | BypassMode;

export const BYPASS_CHIPS: readonly { id: BypassChoice; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "off", label: "Off" },
  { id: "urgent", label: "Urgent only" },
  { id: "all", label: "All alerts" },
];

/** The chip for a bot's override of one setting: "default" when it has none. */
export function bypassChoice(bypass: BotBypass | undefined, which: "dnd" | "silent"): BypassChoice {
  return bypass?.[which] ?? "default";
}

/** What a chip stores: a mode, or null to go back to the default. */
export function bypassChange(choice: BypassChoice): BypassMode | null {
  return choice === "default" ? null : choice;
}

/* ----------------------------------------------------------------------- home */

/** The flock under "All quiet" (and "N bots can page you"): one blob per paired bot, in its colour, oldest first. */
export function flockBots(bots: readonly BotListItem[]): KnownBot[] {
  return [...bots]
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
    .map((bot) => {
      const colour = requestedColour(bot.colour);
      return { botId: bot.botId, botName: bot.name, ...(colour === null ? {} : { colour }) };
    });
}

/* ------------------------------------------------------- muted bots and the deck */

/** The ids of the bots whose mute is in force at `now`. */
export function mutedBotIds(
  bots: readonly Pick<BotListItem, "botId" | "mutedUntil">[],
  now: number,
): Set<string> {
  return new Set(bots.filter((bot) => isMuted(bot.mutedUntil, now)).map((bot) => bot.botId));
}

/** The soonest time a mute in force ends, or null when no bot is muted. The inbox looks again then. */
export function nextMuteExpiry(
  bots: readonly Pick<BotListItem, "mutedUntil">[],
  now: number,
): number | null {
  let soonest: number | null = null;
  for (const bot of bots) {
    if (bot.mutedUntil !== null && bot.mutedUntil > now && (soonest === null || bot.mutedUntil < soonest)) {
      soonest = bot.mutedUntil;
    }
  }
  return soonest;
}

/**
 * The alerts that may take over the screen by themselves (the alert, or the stack): a muted bot's
 * alerts are left out and wait under Needs you on Home. An alert he chose himself (a tap on its
 * Needs you card, or a notification) always shows, muted or not. Undefined stays undefined (still loading).
 */
export function takeoverAlerts<T extends { questionId: string; botId: string }>(
  pending: readonly T[] | undefined,
  muted: ReadonlySet<string>,
  chosenId: string | null,
): T[] | undefined {
  if (pending === undefined) return undefined;
  return muted.size === 0 ? [...pending] : pending.filter((item) => !muted.has(item.botId) || item.questionId === chosenId);
}
