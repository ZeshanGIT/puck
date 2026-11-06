/**
 * The pure rules of H4 Alert detail, with no React Native imports so `bun test` can load them: the
 * status line, which options were picked, the timeline rows and their times, when "Try again" shows,
 * and the attachment chips. Shapes are those of `alerts.get` (all times epoch ms).
 * Prototype: `SCREENS.detail` in `vault/Projects/Puck/mockups/Puck prototype.html`; `App screens.md`
 * H4; `User journeys.md` J10.
 */
import { formatBytes } from "./attachments";
import { dayLabel, snoozeNote } from "./homeModel";

/* ------------------------------------------------------------------ query shapes */

export type TimelineKind = "created" | "snoozed" | "answered" | "delivered" | "failed" | "cancelled" | "missed";

export interface DetailOption {
  id: string;
  label: string;
  icon: string | null;
  desc: string | null;
  tone: string | null;
  rec: boolean;
  chosen: boolean;
}

export interface DetailAttachment {
  name: string;
  type: string;
  size: number;
}

export interface DetailAnswer {
  answerId: string;
  /** The labels he picked, as the phone shows them. */
  picks: string[];
  customReply: string | null;
  attachments: DetailAttachment[];
  answeredAt: number;
  answeredByClientName: string | null;
}

export interface DetailDelivery {
  state: "pending" | "sent" | "delivered" | "failed";
  attempts: number;
  lastError: string | null;
}

export interface DetailTimelineEvent {
  kind: TimelineKind;
  at: number;
  text: string;
}

/** One alert from `alerts.get({ clientId, questionId })`. */
export interface AlertDetail {
  questionId: string;
  question: string;
  message: string | null;
  details: string | null;
  link: { label: string; url: string } | null;
  priority: "normal" | "urgent";
  presentation: string;
  selectionMode: string;
  status: "scheduled" | "pending" | "answered" | "cancelled" | "snoozed";
  options: DetailOption[];
  expiresAt: number | null;
  createdAt: number;
  botId: string;
  botName: string;
  answer: DetailAnswer | null;
  delivery: DetailDelivery | null;
  snoozes: { at: number; until: number | null }[];
  timeline: DetailTimelineEvent[];
}

/* ------------------------------------------------------------------------ times */

const pad = (value: number): string => String(value).padStart(2, "0");

/** "21:04": 24-hour, two digits, in the phone's time zone. */
export function hourMinute(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "21:04" today, "Yesterday 21:04", then the weekday or the date with the time. */
export function timeLabel(ms: number, now: number): string {
  const day = dayLabel(ms, now);
  return day === "Today" ? hourMinute(ms) : `${day} ${hourMinute(ms)}`;
}

/* ----------------------------------------------------------------- the alert */

/** Missed: nothing was answered and the alert passed its `expiresAt` (or the timeline says so). */
export function isMissed(alert: AlertDetail, now: number): boolean {
  if (alert.answer) return false;
  if (alert.timeline.some((event) => event.kind === "missed")) return true;
  return alert.status === "pending" && alert.expiresAt !== null && alert.expiresAt <= now;
}

/**
 * The line under the question: "You answered", "Cancelled", "Missed", the snooze note ("Back in 10
 * min", "Snoozed until you're back"), or "Unanswered". The words carry the status, not the colour.
 */
export function statusLine(alert: AlertDetail, now: number): string {
  if (alert.answer) return "You answered";
  if (alert.status === "cancelled" || alert.timeline.some((event) => event.kind === "cancelled")) return "Cancelled";
  if (isMissed(alert, now)) return "Missed";
  if (alert.status === "snoozed") {
    const latest = alert.snoozes[alert.snoozes.length - 1];
    return snoozeNote(latest?.until ?? null, now);
  }
  return "Unanswered";
}

/** The alert's time, shown under the bot's name. */
export function alertWhen(alert: AlertDetail, now: number): string {
  return timeLabel(alert.createdAt, now);
}

/** The reply he typed, for the quote block; null when there is none. */
export function replyQuote(alert: AlertDetail): string | null {
  return alert.answer?.customReply ?? null;
}

export interface OptionRow {
  id: string;
  label: string;
  desc: string | null;
  destructive: boolean;
  picked: boolean;
}

/**
 * The options in the order the alert gave them. `picked` is the backend's `chosen` flag, and only
 * on an answered alert (a missed or cancelled one shows no picks).
 */
export function optionRows(alert: AlertDetail): OptionRow[] {
  const answered = alert.answer !== null;
  return alert.options.map((option) => ({
    id: option.id,
    label: option.label,
    desc: option.desc,
    destructive: option.tone === "destructive",
    picked: answered && option.chosen,
  }));
}

/* --------------------------------------------------------------- the timeline */

export type TimelineTone = "ok" | "bad" | "neutral";

export interface TimelineRow {
  key: string;
  text: string;
  time: string;
  tone: TimelineTone;
}

/** Failed and missed are the red dots; sent, answered and delivered are green; the rest are grey. */
export function timelineTone(kind: TimelineKind): TimelineTone {
  if (kind === "failed" || kind === "missed") return "bad";
  if (kind === "created" || kind === "answered" || kind === "delivered") return "ok";
  return "neutral";
}

/** The timeline oldest first, as the backend gives it. */
export function timelineRows(alert: AlertDetail, now: number): TimelineRow[] {
  return alert.timeline.map((event, index) => ({
    key: `${index}-${event.kind}`,
    text: event.text,
    time: timeLabel(event.at, now),
    tone: timelineTone(event.kind),
  }));
}

/* ----------------------------------------------------------------- delivery */

/** "Try again" is for an answer whose delivery to the bot failed for good (J10). */
export function showTryAgain(alert: AlertDetail): boolean {
  return alert.answer !== null && alert.delivery?.state === "failed";
}

/** The last error, in small text under "Try again"; only while that button is up. */
export function deliveryError(alert: AlertDetail): string | null {
  return showTryAgain(alert) ? (alert.delivery?.lastError ?? null) : null;
}

/**
 * The message for a failed `answers.retryDelivery` call: the text the server threw (the first line
 * after "Uncaught Error:" when Convex wraps it), for a Toast.
 */
export function retryErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong";
  const text = error.message;
  const marker = "Uncaught Error:";
  const at = text.indexOf(marker);
  const body = at >= 0 ? text.slice(at + marker.length) : text;
  return body.split("\n")[0]?.trim() || "Something went wrong";
}

/* -------------------------------------------------------------- attachments */

export interface AttachmentChip {
  key: string;
  name: string;
  /** "18 KB", as the reply's own size line. */
  size: string;
}

/** The files on his reply, as chips with their name and size only. */
export function attachmentChips(alert: AlertDetail): AttachmentChip[] {
  return (alert.answer?.attachments ?? []).map((file, index) => ({
    key: `${index}-${file.name}`,
    name: file.name,
    size: formatBytes(file.size),
  }));
}
