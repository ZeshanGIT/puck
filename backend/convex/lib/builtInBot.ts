// Pure rules for the built-in Puck bot and the test page it sends. No Convex imports, so `bun test` can run them.

import type { AlertOption } from "@puck/shared";

/** The public id of the built-in bot. No generated bot id can equal it (those end in digits). */
export const BUILT_IN_BOT_ID = "puck-builtin";
export const BUILT_IN_BOT_NAME = "Puck";

/** Same wording as the onboarding prototype (`SCREENS.test`, the "Puck" sample bot). */
export const TEST_PAGE_QUESTION = "Can you hear me?";
export const TEST_PAGE_OPTIONS: readonly AlertOption[] = [
  { id: "yes", label: "Yes, loud and clear" },
  { id: "no", label: "Not really" },
];

/**
 * A test page younger than this is "still ringing", so a repeat request returns it instead of
 * sending another. An older unanswered one was dismissed or missed: it is cancelled and replaced,
 * so Send a test page always rings after a retry.
 */
export const TEST_PAGE_FRESH_MS = 2 * 60 * 1000;

export interface PendingTestPage {
  questionId: string;
  createdAt: number;
}

export type TestPageDecision =
  | { action: "reuse"; questionId: string }
  | { action: "create"; cancel: string[] };

/**
 * What `alerts.sendTest` does, given this client's pending test alerts from the built-in bot.
 * At most one unanswered test alert per client: a fresh one is reused (newest wins), stale ones
 * are cancelled before a new one is made.
 */
export function decideTestPage(pending: readonly PendingTestPage[], now: number): TestPageDecision {
  const fresh = pending
    .filter((page) => now - page.createdAt < TEST_PAGE_FRESH_MS)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (fresh.length > 0) return { action: "reuse", questionId: fresh[0]!.questionId };
  return { action: "create", cancel: pending.map((page) => page.questionId) };
}

/** Whether a bot row is the built-in Puck bot. */
export function isBuiltInBot(bot: { builtIn?: boolean | null } | null | undefined): boolean {
  return bot?.builtIn === true;
}

export type DeliveryRoute = "webhook" | "built-in";

/** Answers to the built-in bot are marked delivered at once; they are never POSTed anywhere. */
export function deliveryRoute(bot: { builtIn?: boolean | null }): DeliveryRoute {
  return isBuiltInBot(bot) ? "built-in" : "webhook";
}

/** The built-in bot can never authenticate a bot request, whatever secret hash is presented. */
export function botMayAuthenticate(bot: { builtIn?: boolean | null }): boolean {
  return !isBuiltInBot(bot);
}
