/**
 * Keeps a notification/full-screen launch from flashing Home while Convex and the deck catch up.
 */

export function pickDeckAlert<T extends { questionId: string }>(
  live: readonly T[],
  preferredQuestionId: string | null,
): T | null {
  if (preferredQuestionId) {
    return live.find((item) => item.questionId === preferredQuestionId) ?? null;
  }
  return live[0] ?? null;
}

/** True when the inbox may dismiss the opening screen (O0) and show real UI beneath. */
export function alertLaunchSettled(
  launchId: string | null,
  pending: readonly { questionId: string }[] | undefined,
  visible: readonly { questionId: string }[] | undefined,
  deckQuestionId: string | null,
): boolean {
  if (!launchId) return true;
  if (pending === undefined || visible === undefined) return false;
  if (deckQuestionId === launchId) return true;
  const inPending = pending.some((item) => item.questionId === launchId);
  const inVisible = visible.some((item) => item.questionId === launchId);
  if (!inPending && !inVisible) return true;
  if (inVisible) return false;
  return false;
}

/** Home is appropriate; false means keep the blank placeholder (not Home) under the opening screen. */
export function inboxShowsHome(input: {
  deckAlert: unknown;
  launchId: string | null;
  pending: readonly { questionId: string }[] | undefined;
  visible: readonly { questionId: string }[] | undefined;
}): boolean {
  if (input.deckAlert) return false;
  if (!input.launchId) return true;
  if (input.pending === undefined || input.visible === undefined) return false;
  return alertLaunchSettled(input.launchId, input.pending, input.visible, null);
}
