/**
 * The alert lifecycle, in one place.
 *
 *   scheduled --release(due)--------------> pending
 *   pending   --snooze--------------------> snoozed
 *   snoozed   --snooze (a later one)------> snoozed
 *   snoozed   --snoozeElapsed(current)----> pending   (the timed snooze job that set it)
 *   snoozed   --wake(untimed)-------------> pending   ("until I'm back", app returns)
 *   scheduled | pending | snoozed --answer-> answered  (answered while scheduled is allowed; see below)
 *   scheduled | pending | snoozed --cancel-> cancelled
 *
 * `answered` and `cancelled` are final. "Missed" (past `expiresAt`) is not a stored status: it is
 * derived from the clock by `goneReason` and `historyOutcome`.
 *
 * Every mutation that changes `alerts.status` asks `decideAlert` first, so the guards, the target
 * status and the error text are the same everywhere. The messages are the ones the mutations threw
 * before this module existed (clients and the CLI match on them), so they must not change.
 *
 * Deliberately kept loose: `answer` does not reject a `scheduled` alert, because the mutation never
 * did. A scheduled alert has no push and is not on any phone, so this is unreachable in practice;
 * tightening it is a behaviour change for the owner to decide, not part of this refactor.
 */
import { defineMachine } from "./machine";
import type { AlertStatus } from "./model";

// Local, not imported from model.ts, so that model.ts can use this module without an import cycle.
// The Record forces this list to cover every AlertStatus.
const STATUS_SET: Record<AlertStatus, true> = {
  scheduled: true,
  pending: true,
  snoozed: true,
  answered: true,
  cancelled: true,
};
const ALL_STATUSES = Object.keys(STATUS_SET) as AlertStatus[];

export type AlertEvent =
  | { type: "answer" }
  | { type: "snooze" }
  /** `due`: `scheduledFor` has arrived (or there is none). */
  | { type: "release"; due: boolean }
  /** `current`: the stored `snoozedUntil` is the one this job was scheduled for. */
  | { type: "snoozeElapsed"; current: boolean }
  /** `untimed`: the stored snooze has no end time ("until I'm back"). */
  | { type: "wake"; untimed: boolean }
  | { type: "cancel" };

export interface AlertDecision {
  /** The status after the event (the same status when nothing changes). */
  status: AlertStatus;
  /** True when `status` differs from the one given. */
  changed: boolean;
  /** The error a mutation throws, or null when the event is allowed or a quiet no-op. */
  rejection: string | null;
}

const ALREADY_ANSWERED = "alert is already answered";
const CANCELLED = "alert is cancelled";
const NOT_PENDING = "alert is not pending";

function stay(status: AlertStatus): AlertDecision {
  return { status, changed: false, rejection: null };
}

function move(from: AlertStatus, to: AlertStatus): AlertDecision {
  return { status: to, changed: from !== to, rejection: null };
}

function reject(status: AlertStatus, message: string): AlertDecision {
  return { status, changed: false, rejection: message };
}

/** The status an alert starts in: `scheduled` while its time is in the future, else `pending`. */
export function initialAlertStatus(scheduledFor: number | null, now: number): AlertStatus {
  return scheduledFor !== null && scheduledFor > now ? "scheduled" : "pending";
}

/** What an event does to an alert in `status`. Pure and total. */
export function decideAlert(status: AlertStatus, event: AlertEvent): AlertDecision {
  switch (event.type) {
    case "answer":
      if (status === "answered") return reject(status, ALREADY_ANSWERED);
      if (status === "cancelled") return reject(status, CANCELLED);
      return move(status, "answered");
    case "snooze":
      if (status === "answered") return reject(status, ALREADY_ANSWERED);
      if (status === "cancelled") return reject(status, CANCELLED);
      if (status === "pending" || status === "snoozed") return move(status, "snoozed");
      return reject(status, NOT_PENDING);
    case "release":
      return status === "scheduled" && event.due ? move(status, "pending") : stay(status);
    case "snoozeElapsed":
      return status === "snoozed" && event.current ? move(status, "pending") : stay(status);
    case "wake":
      return status === "snoozed" && event.untimed ? move(status, "pending") : stay(status);
    case "cancel":
      if (status === "answered") return reject(status, ALREADY_ANSWERED);
      if (status === "cancelled") return stay(status);
      return move(status, "cancelled");
  }
}

/** True once nothing can change the alert any more. */
export function isFinalAlertStatus(status: AlertStatus): boolean {
  return status === "answered" || status === "cancelled";
}

/** True while the alert can still be shown to the person (pending, or set aside by a snooze). */
export function isWaitingAlertStatus(status: AlertStatus): boolean {
  return status === "pending" || status === "snoozed";
}

export const alertLifecycle = defineMachine<AlertStatus, AlertEvent>({
  name: "alert-lifecycle",
  summary:
    "Stored status of one alert: scheduled, pending, snoozed, answered, cancelled. Every status write in the backend asks decideAlert first.",
  usedBy: [
    "backend/convex/alerts.ts",
    "backend/convex/answers.ts",
    "backend/convex/bots.ts",
    "packages/shared/src/schedule.ts",
    "packages/shared/src/model.ts",
  ],
  initial: "pending",
  transition: (status, event) => decideAlert(status, event).status,
  label: (status) => status,
  invariant: (status) => (ALL_STATUSES.includes(status) ? null : `unknown status ${String(status)}`),
  samples: {
    states: ALL_STATUSES,
    events: [
      { type: "answer" },
      { type: "snooze" },
      { type: "release", due: true },
      { type: "release", due: false },
      { type: "snoozeElapsed", current: true },
      { type: "snoozeElapsed", current: false },
      { type: "wake", untimed: true },
      { type: "wake", untimed: false },
      { type: "cancel" },
    ],
  },
});
