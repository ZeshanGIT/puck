import { decideAlert } from "./alertLifecycle";
import type { AlertStatus } from "./model";

export type ReleaseStep = "pending" | "wait" | "skip";

/**
 * A scheduled alert becomes pending once its time has arrived.
 * Anything that is no longer scheduled is left alone, including a cancel.
 */
export function releaseStep(status: AlertStatus, scheduledFor: number | null, now: number): ReleaseStep {
  if (status !== "scheduled") return "skip";
  const due = scheduledFor === null || scheduledFor <= now;
  return decideAlert(status, { type: "release", due }).changed ? "pending" : "wait";
}

export type CancelStep = "cancelled" | "unchanged" | "rejected";

/** Pending, scheduled and snoozed alerts can be cancelled (J9). An answer cannot be undone. */
export function cancelStep(status: AlertStatus): CancelStep {
  const decision = decideAlert(status, { type: "cancel" });
  if (decision.rejection !== null) return "rejected";
  return decision.changed ? "cancelled" : "unchanged";
}
