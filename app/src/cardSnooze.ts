/**
 * Alerts whose compact card was snoozed. The app opens each one once: on its snooze choices (the
 * Snooze button), or straight into a snooze of the length the swipe picked (5 minutes, 10 minutes,
 * or until the person is back). A request made while the alert is already on screen is also picked
 * up through the listeners.
 */

/** What the card asked for: the choices sheet, or a snooze for `minutes` (null: until I'm back). */
export type CardSnoozeRequest = { kind: "choose" } | { kind: "timed"; minutes: number | null };

/** The native card sends 0 for "show the choices", -1 for "until I'm back", else the minutes. */
export const CARD_SNOOZE_UNTIL_BACK = -1;

export function cardSnoozeFromNative(minutes: number | undefined): CardSnoozeRequest {
  if (minutes === CARD_SNOOZE_UNTIL_BACK) return { kind: "timed", minutes: null };
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) return { kind: "timed", minutes };
  return { kind: "choose" };
}

/** The `until` for `answers.snooze` for a timed card snooze: epoch ms, or null for "until I'm back". */
export function cardSnoozeUntil(minutes: number | null, now: number): number | null {
  return minutes === null ? null : now + minutes * 60_000;
}

const pending = new Map<string, CardSnoozeRequest>();
const listeners = new Set<() => void>();

export function requestSnoozeOnOpen(questionId: string, request: CardSnoozeRequest = { kind: "choose" }): void {
  pending.set(questionId, request);
  for (const listener of listeners) listener();
}

/** The request for this alert, once; null when the card asked for nothing. */
export function takeSnoozeOnOpen(questionId: string): CardSnoozeRequest | null {
  const request = pending.get(questionId) ?? null;
  pending.delete(questionId);
  return request;
}

export function subscribeSnoozeRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const handledOpens = new Set<number>();

/**
 * One card gesture can reach JavaScript by two routes (the new-intent event and the pending
 * request taken when the app comes forward). Each request carries a unique nonce; this is true the
 * first time a nonce is seen and false after, so a timed snooze runs once. Nonce 0 (a build that
 * sends none) is always handled.
 */
export function shouldHandleOpen(nonce: number): boolean {
  if (nonce === 0) return true;
  if (handledOpens.has(nonce)) return false;
  handledOpens.add(nonce);
  return true;
}
