// The rule behind Try again (H4): only a failed delivery can be retried, and not more than once
// every RETRY_MIN_GAP_MS for the same answer. Pure, so the tests can run it directly.

export const RETRY_MIN_GAP_MS = 10_000;

export type RetryDecision = { action: "retry" } | { action: "refuse"; message: string };

/**
 * `lastRetryAt` is when the last manual retry started, or null when there has been none.
 * A pending answer is already on its way, and a delivered one needs nothing.
 */
// `deliveryStatus` is a string: the Convex validator widens the stored literal union (schema.ts).
export function decideRetry(
  answer: { deliveryStatus: string; lastRetryAt: number | null },
  now: number,
): RetryDecision {
  if (answer.deliveryStatus === "delivered") {
    return { action: "refuse", message: "answer was already delivered" };
  }
  if (answer.deliveryStatus === "pending") {
    return { action: "refuse", message: "answer delivery is already pending" };
  }
  if (answer.lastRetryAt !== null && now - answer.lastRetryAt < RETRY_MIN_GAP_MS) {
    return { action: "refuse", message: "retry too soon: wait 10 seconds between tries" };
  }
  return { action: "retry" };
}
