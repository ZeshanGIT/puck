import { snoozeNote } from "./homeModel";

/** Under this many seconds the pill turns amber. */
const EXPIRY_LOW_SECONDS = 5 * 60;

/**
 * Convex sends "no expiry" as `null`; the app's alert types say `undefined`. Only a real time
 * counts. Read as a number, `null` is 0: every alert then looked Missed, answers were disabled, and
 * "Expired at" showed epoch 0 (5:30 in India).
 */
export function expiryOf(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** True once the alert has a real expiry time and it has passed. */
export function hasExpired(expiresAt: number | null | undefined, now: number): boolean {
  const at = expiryOf(expiresAt);
  return at !== undefined && now >= at;
}

/** A snoozed alert's wake time: epoch ms, or null for "until I'm back". Null when it is not snoozed. */
export interface SnoozeState {
  until: number | null;
}

/** The snooze state of a waiting alert, or undefined when it is not snoozed. */
export function snoozeOf(alert: { status?: string; snoozedUntil?: number | null }): SnoozeState | undefined {
  return alert.status === "snoozed" ? { until: alert.snoozedUntil ?? null } : undefined;
}

export interface ExpiryView {
  /** "12 min left", "45 s left", "Missed", or the snooze note ("Back in 4 min") while snoozed. */
  label: string;
  /** Share of the alert's life that is left, 0 to 1 (drives the short bar). */
  fraction: number;
  /** Under 5 minutes: the pill turns amber. */
  low: boolean;
  /** The time has passed: the alert can't be answered. Never true for a snooze with no real expiry. */
  expired: boolean;
  /** Snoozed and not past its expiry: the label is the snooze note, not a countdown. */
  snoozed: boolean;
}

/** Shown in the pill while an alert waits. Null when it has no expiry and is not snoozed. */
export function expiryView(input: {
  expiresAt: number | null | undefined;
  createdAt?: number;
  opened: number;
  now: number;
  snooze?: SnoozeState;
}): ExpiryView | null {
  const at = expiryOf(input.expiresAt);
  const expired = at !== undefined && input.now >= at;
  const total = at === undefined ? 1 : Math.max(1000, at - (input.createdAt ?? input.opened));
  const remaining = at === undefined ? total : Math.max(0, at - input.now);
  if (input.snooze && !expired) {
    return {
      label: snoozeNote(input.snooze.until, input.now),
      fraction: Math.min(1, remaining / total),
      low: false,
      expired: false,
      snoozed: true,
    };
  }
  if (at === undefined) return null;
  const seconds = remaining / 1000;
  return {
    label: expired ? "Missed" : seconds >= 60 ? `${Math.ceil(seconds / 60)} min left` : `${Math.ceil(seconds)} s left`,
    fraction: Math.min(1, remaining / total),
    low: expired || seconds < EXPIRY_LOW_SECONDS,
    expired,
    snoozed: false,
  };
}

/** Waiting alerts from Convex with `null` expiry read as "never expires" (undefined) in the app. */
export function normalizeExpiry<T extends { expiresAt?: number | null }>(alert: T): Omit<T, "expiresAt"> & { expiresAt?: number } {
  const { expiresAt, ...rest } = alert;
  const at = expiryOf(expiresAt);
  return at === undefined ? (rest as Omit<T, "expiresAt">) : { ...rest, expiresAt: at };
}
