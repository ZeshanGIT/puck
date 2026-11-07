/**
 * What covers the screen between the native splash and the real Home.
 *
 * On a restart the app works through: fonts, the Clerk session and this phone's client, the
 * onboarding flag, and then the inbox's first data (pending alerts, the bot list, what waits, the
 * first page of history). Until all of that is here, the same opening screen (O0: the Puck blob on
 * the screen background) stays up, so nothing else flashes by: no captioned page, no empty Home that
 * fills in. A safety timeout lets the inbox show anyway when a query never answers.
 */
import type { AppGate } from "./accountGate";

/** How long the inbox may keep the opening screen up before Home shows with whatever it has. */
export const INBOX_READY_TIMEOUT_MS = 4000;

export function openingVisible(input: {
  gate: AppGate;
  signingOut: boolean;
  /** The inbox has its first data (`Inbox` reports it). */
  inboxReady: boolean;
  /** The safety timeout has run out. */
  timedOut: boolean;
}): boolean {
  if (input.signingOut || input.gate === "opening") return true;
  if (input.gate === "inbox") return !input.inboxReady && !input.timedOut;
  return false;
}

/**
 * The inbox has what Home needs to draw once: the pending alerts, and (on a registered phone) the bot
 * list, the waiting list and the first page of history. Each is undefined while it loads.
 */
export function inboxReady(input: {
  clientId: string | null | undefined;
  pending: unknown;
  bots: unknown;
  waiting: unknown;
  historyLoading: boolean;
}): boolean {
  if (input.clientId === undefined || input.pending === undefined) return false;
  if (!input.clientId) return true;
  return input.bots !== undefined && input.waiting !== undefined && !input.historyLoading;
}
