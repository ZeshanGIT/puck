// Pure rules for the Needs you and Earlier lists and the H4 timeline. No database access here,
// so the tests in backend/test can run them directly.

import { receiptState, type AlertStatus, type DeliveryStatus } from "@puck/shared";

export type HistoryOutcome = "answered" | "cancelled" | "missed";

export type TimelineKind = "created" | "snoozed" | "answered" | "delivered" | "failed" | "cancelled" | "missed";

export interface TimelineEvent {
  kind: TimelineKind;
  /** Epoch ms. */
  at: number;
  text: string;
}

/**
 * Whether an alert counts as waiting on him (Needs you): pending or snoozed, and not past its
 * expiry. The server never flips the status for expiry, so the clock decides.
 */
export function isWaiting(status: AlertStatus, expiresAt: number | null, now: number): boolean {
  if (status !== "pending" && status !== "snoozed") return false;
  return expiresAt === null || expiresAt > now;
}

/**
 * The Earlier outcome of an alert, or null when it is not history yet. Answered and cancelled
 * are final. A pending or snoozed alert past its expiry is missed. Scheduled alerts, and pending
 * or snoozed ones still inside their expiry, are not history.
 */
export function historyOutcome(
  alert: { status: AlertStatus; expiresAt: number | null },
  now: number,
): HistoryOutcome | null {
  if (alert.status === "answered") return "answered";
  if (alert.status === "cancelled") return "cancelled";
  const open = alert.status === "pending" || alert.status === "snoozed";
  if (open && alert.expiresAt !== null && alert.expiresAt <= now) return "missed";
  return null;
}

export interface TimelineInput {
  botName: string;
  createdAt: number;
  status: AlertStatus;
  expiresAt: number | null;
  /** When the alert last changed. For a cancelled alert that is when it was cancelled. */
  updatedAt: number;
  answer: {
    answeredAt: number;
    answeredByClientName: string | null;
    /** When the bot took it. Absent on rows from before `deliveredAt` existed. */
    deliveredAt?: number | null;
    // `string` because the Convex validator widens the literal union (see schema.ts `literals`).
    deliveryStatus: string;
    deliveryAttempts: number;
    lastError: string | null;
  } | null;
  snoozes: { snoozedAt: number; snoozedUntil: number | null }[];
}

/**
 * The receipt the app shows for a stored answer (`receiptState`). Takes the stored row's shape,
 * whose status the Convex validator types as a plain string.
 */
export function answerReceipt(answer: {
  deliveryStatus: string;
  deliveryAttempts: number;
  lastError?: string | null;
}) {
  return receiptState({
    deliveryStatus: answer.deliveryStatus as DeliveryStatus,
    deliveryAttempts: answer.deliveryAttempts,
    lastError: answer.lastError,
  });
}

/** Order when two events share a time: the order they can only have happened in. */
const RANK: Record<TimelineKind, number> = {
  created: 0,
  snoozed: 1,
  answered: 2,
  delivered: 3,
  failed: 3,
  cancelled: 4,
  missed: 4,
};

/**
 * The H4 timeline: sent, each snooze, answered (and on which client), delivered or not, cancelled
 * or missed. Oldest first.
 *
 * A delivered event uses `deliveredAt`, falling back to the answer time for older rows.
 */
export function buildTimeline(input: TimelineInput, now: number): TimelineEvent[] {
  const events: TimelineEvent[] = [{ kind: "created", at: input.createdAt, text: `Sent by ${input.botName}` }];
  for (const snooze of input.snoozes) {
    events.push({
      kind: "snoozed",
      at: snooze.snoozedAt,
      text: snooze.snoozedUntil === null ? "Snoozed until you're back" : "Snoozed until the set time",
    });
  }
  if (input.answer) {
    const { answer } = input;
    events.push({
      kind: "answered",
      at: answer.answeredAt,
      text: answer.answeredByClientName ? `Answered on ${answer.answeredByClientName}` : "Answered",
    });
    const receipt = answerReceipt(answer);
    if (receipt === "delivered") {
      events.push({
        kind: "delivered",
        at: answer.deliveredAt ?? answer.answeredAt,
        text: `Delivered to ${input.botName}`,
      });
    } else if (receipt === "failed") {
      events.push({ kind: "failed", at: answer.answeredAt, text: `Not delivered to ${input.botName} yet` });
    }
  }
  const outcome = historyOutcome({ status: input.status, expiresAt: input.expiresAt }, now);
  if (outcome === "cancelled") {
    events.push({ kind: "cancelled", at: input.updatedAt, text: "Cancelled" });
  } else if (outcome === "missed" && input.expiresAt !== null) {
    events.push({ kind: "missed", at: input.expiresAt, text: "Missed: it expired before anyone answered" });
  }
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.at - b.event.at || RANK[a.event.kind] - RANK[b.event.kind] || a.index - b.index)
    .map(({ event }) => event);
}
