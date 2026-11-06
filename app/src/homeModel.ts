/**
 * The pure rules of H1 Home, with no React Native imports so `bun test` can load them: which health
 * banners show and in what order (H3), what "Needs you" shows and what each card says, the history's
 * rows and their day groups, and when home is H2 (no bots yet). Prototype: `SCREENS.home`,
 * `rowHTML` and `.banner` (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` H1,
 * H2, H3.
 *
 * Shapes are those of `alerts.waiting` and `alerts.history` (all times epoch ms).
 */
import type { LocalSettings } from "./localSettings";
import type { PaletteName } from "./ui/botTheme";
import { answerSummary, clockLabel } from "./receiptCopy";

/* ------------------------------------------------------------------ query shapes */

/** One row of `alerts.waiting({ clientId })`. */
export interface WaitingAlert {
  questionId: string;
  question: string;
  botId: string;
  botName: string;
  priority: string;
  status: "pending" | "snoozed";
  presentation: string;
  selectionMode: string;
  snoozedUntil: number | null;
  expiresAt: number | null;
  createdAt: number;
}

export type HistoryOutcome = "answered" | "cancelled" | "missed";

/** One item of a page of `alerts.history({ clientId, paginationOpts })`. */
export interface HistoryItem {
  questionId: string;
  question: string;
  botName: string;
  outcome: HistoryOutcome;
  picks: string[];
  customReply: string | null;
  hasAttachments: boolean;
  answeredAt: number | null;
  answeredByClientName: string | null;
  deliveryStatus: "pending" | "delivered" | "failed" | null;
  createdAt: number;
}

/* ------------------------------------------------------------------- H3 banners */

/** The warnings home can show today, in H3's order (signed out, and muted bots, need data we do not have yet). */
export type BannerId = "notifications" | "fullScreen" | "dnd" | "offline";

export interface BannerCopy {
  message: string;
  /** The fix button; none for offline, which fixes itself. */
  action?: string;
}

/** H3 items 1, 3, 4 and 5. The first and the third are the prototype's words; the Do Not Disturb one follows H3. */
export const BANNER_COPY: Record<BannerId, BannerCopy> = {
  notifications: { message: "Notifications are off, so bots can't reach you while Puck is closed.", action: "Turn on" },
  fullScreen: { message: "Urgent alerts can't show over the lock screen.", action: "Allow" },
  dnd: {
    message: "Puck has no Do Not Disturb access, so alerts allowed to ring through it can't.",
    action: "Allow",
  },
  offline: { message: "You're offline. Answers wait on this phone and send when you're back." },
};

/**
 * Do Not Disturb access matters only while some setting lets alerts ring through it (Q6): the
 * global setting, or any bot's own override, is not Off.
 */
export function dndBypassActive(settings: Pick<LocalSettings, "bypassDnd" | "bots">): boolean {
  if (settings.bypassDnd !== "off") return true;
  return Object.values(settings.bots).some((bot) => bot.dnd !== undefined && bot.dnd !== "off");
}

/**
 * The banners to show, most serious first (H3). Each input is true only when it is known: `null`
 * (not read yet, or an older build that cannot tell) is not a problem.
 */
export function healthBanners(input: {
  notificationsOff: boolean;
  fullScreenOff: boolean;
  /** No Do Not Disturb access AND a bypass setting is on. */
  dndOff: boolean;
  offline: boolean;
}): BannerId[] {
  const out: BannerId[] = [];
  if (input.notificationsOff) out.push("notifications");
  if (input.fullScreenOff) out.push("fullScreen");
  if (input.dndOff) out.push("dnd");
  if (input.offline) out.push("offline");
  return out;
}

/* --------------------------------------------------------------------- Needs you */

export interface NeedItem {
  questionId: string;
  botId: string;
  botName: string;
  question: string;
  urgent: boolean;
  status: "pending" | "snoozed";
  /** His answer is on the phone and has not been sent (J11). */
  queued: boolean;
  createdAt: number;
  /** The card's bottom line: "Unanswered", "Back in 10 min", "Snoozed until you're back", "Not sent yet". */
  note: string;
  /** The note is amber (`.nm.warn`). */
  noteWarn: boolean;
}

const MINUTE_MS = 60_000;

/** `Back in 10 min` for a short snooze, `Back at 14:05` for a long one, "until you're back" for none. */
export function snoozeNote(until: number | null, now: number): string {
  if (until === null) return "Snoozed until you're back";
  const minutes = Math.max(1, Math.ceil((until - now) / MINUTE_MS));
  return minutes < 60 ? `Back in ${minutes} min` : `Back at ${clockLabel(until)}`;
}

/**
 * The cards for "Needs you": what is waiting, pending before snoozed, urgent first within each, the
 * rest in the order given (oldest first). `queuedIds` are alerts whose answer waits on the phone.
 */
export function needsYou(
  waiting: readonly WaitingAlert[],
  input: { now: number; queuedIds: ReadonlySet<string> },
): NeedItem[] {
  const items = waiting.map((alert, position): { item: NeedItem; position: number } => {
    const queued = alert.status === "pending" && input.queuedIds.has(alert.questionId);
    const note =
      alert.status === "snoozed" ? snoozeNote(alert.snoozedUntil, input.now) : queued ? "Not sent yet" : "Unanswered";
    return {
      position,
      item: {
        questionId: alert.questionId,
        botId: alert.botId,
        botName: alert.botName,
        question: alert.question,
        urgent: alert.priority === "urgent",
        status: alert.status,
        queued,
        createdAt: alert.createdAt,
        note,
        noteWarn: queued,
      },
    };
  });
  return items
    .sort((a, b) => {
      const status = Number(a.item.status === "snoozed") - Number(b.item.status === "snoozed");
      if (status !== 0) return status;
      const urgent = Number(b.item.urgent) - Number(a.item.urgent);
      if (urgent !== 0) return urgent;
      return a.position - b.position;
    })
    .map((entry) => entry.item);
}

/** "Needs you · 3": the count shows with more than one card (prototype). */
export function needsTitle(count: number): string {
  return count > 1 ? `Needs you · ${count}` : "Needs you";
}

/**
 * How many alerts "Go through all N" would open as a stack: the ones still pending and not waiting
 * on the phone (a snoozed alert cannot be answered from the stack). The button needs two or more.
 */
export function stackableCount(items: readonly NeedItem[]): number {
  return items.filter((item) => item.status === "pending" && !item.queued).length;
}

/**
 * The stack button's label. `ready` is what the button opens (`stackableCount`), `cards` is the cards
 * listed under "Needs you". The prototype's "Go through all N" when they are the same; otherwise
 * "Go through the N ready now", so the button does not read as all of the cards.
 */
export function goThroughLabel(ready: number, cards: number): string {
  return ready === cards ? `Go through all ${ready}` : `Go through the ${ready} ready now`;
}

/* ---------------------------------------------------------------------- Earlier */

export interface HistoryRowModel {
  questionId: string;
  botName: string;
  question: string;
  /** The moment shown on the right: when he answered, else when the alert came in. */
  at: number;
  /** "9:12" (`clockLabel`). */
  time: string;
  /** `.t3`: "You: Yes", "You: Draft it · Not delivered", "Missed", "Cancelled". */
  detail: string;
  tone: "neutral" | "ok" | "bad";
  icon: "check" | "warn" | null;
}

/** One history item as a row (`rowHTML` with `st` ok, bad or missed). */
export function historyRow(item: HistoryItem): HistoryRowModel {
  const at = item.answeredAt ?? item.createdAt;
  const base = { questionId: item.questionId, botName: item.botName, question: item.question, at, time: clockLabel(at) };
  if (item.outcome === "missed") return { ...base, detail: "Missed", tone: "neutral", icon: null };
  if (item.outcome === "cancelled") return { ...base, detail: "Cancelled", tone: "neutral", icon: null };
  const said =
    item.picks.length > 0
      ? answerSummary(item.picks)
      : item.customReply
        ? `“${item.customReply}”`
        : item.hasAttachments
          ? "a file"
          : "a reply";
  if (item.deliveryStatus === "failed") {
    return { ...base, detail: `You: ${said} · Not delivered`, tone: "bad", icon: "warn" };
  }
  if (item.deliveryStatus === "delivered") return { ...base, detail: `You: ${said}`, tone: "ok", icon: "check" };
  // Still on its way: no tick yet.
  return { ...base, detail: `You: ${said}`, tone: "neutral", icon: null };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
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
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", the weekday for the rest of the week, then "28 October" (with the year when it is not this one). */
export function dayLabel(ms: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(ms);
  if (days < 7) return WEEKDAYS[date.getDay()]!;
  const text = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? text : `${text} ${date.getFullYear()}`;
}

export interface HistoryGroup {
  label: string;
  rows: HistoryRowModel[];
}

/** The rows in the order given, a new group each time the day changes (as the prototype's `e.day`). */
export function groupByDay(items: readonly HistoryItem[], now: number): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const item of items) {
    const row = historyRow(item);
    const label = dayLabel(row.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

/** How many more rows one tap on "Load more" asks for. */
export const HISTORY_PAGE = 20;

/* ------------------------------------------------------------- H2 and all clear */

/**
 * H2 (no bots yet) when everything has loaded and nothing has ever paged him. There is no bots
 * list yet (P6), so "no bots" is read off an empty waiting list and an empty, finished history.
 */
export function isNoBotsYet(input: {
  waiting: readonly unknown[] | undefined;
  history: readonly unknown[] | undefined;
  historyDone: boolean;
}): boolean {
  return (
    input.waiting !== undefined && input.waiting.length === 0 && input.history !== undefined && input.history.length === 0 && input.historyDone
  );
}

export interface KnownBot {
  botId: string;
  botName: string;
  /** The bot's own colour when known (from `bots.list`); otherwise the flock derives one. */
  colour?: PaletteName;
}

/**
 * The bots seen so far, one per name: from the waiting alerts (which carry the bot's id) and the
 * history (which carries only the name, so the name stands in as the id for a bot not seen waiting).
 * The flock under "All quiet" draws these.
 */
export function knownBots(
  waiting: readonly Pick<WaitingAlert, "botId" | "botName">[],
  history: readonly Pick<HistoryItem, "botName">[],
): KnownBot[] {
  const byName = new Map<string, KnownBot>();
  for (const alert of waiting) byName.set(alert.botName, { botId: alert.botId, botName: alert.botName });
  for (const item of history) if (!byName.has(item.botName)) byName.set(item.botName, { botId: item.botName, botName: item.botName });
  return [...byName.values()];
}

/** `${n} bots can page you` under the flock. */
export function flockText(count: number): string {
  return count === 1 ? "1 bot can page you" : `${count} bots can page you`;
}
