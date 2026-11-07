/**
 * Signing out of Puck on this phone (S6). Order matters: the phone's client row is removed first,
 * while the Clerk token still works, so it stops being paged; then the phone's own state about
 * that row is cleared (client id, answers waiting to send); then the Clerk session ends.
 *
 * Removing the row is best effort: a failure or a slow network must not trap the person in the
 * app, so it is given `timeoutMs` and then skipped. A row left behind is replaced the next time
 * this phone signs in under the same name (Q11).
 */

/** How long sign-out waits for the backend to remove the client row. */
export const REMOVE_CLIENT_TIMEOUT_MS = 3000;

export interface SignOutSteps {
  /** `clients.remove` for this phone's client id; a no-op when the phone has none. */
  removeClient: () => Promise<void>;
  /** Forget the stored client id and anything queued for it, and reset the screens. */
  clearLocal: () => Promise<void>;
  /** End the Clerk session. */
  endSession: () => Promise<void>;
}

/** What happened to the row, so a caller can log it: never shown to the person. */
export type RemoveOutcome = "removed" | "failed" | "timed-out";

async function removeWithin(removeClient: () => Promise<void>, timeoutMs: number): Promise<RemoveOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RemoveOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  const attempt = (async (): Promise<RemoveOutcome> => {
    try {
      await removeClient();
      return "removed";
    } catch {
      return "failed";
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs the three steps in order. Only `clearLocal` and `endSession` can throw; the row's removal
 * never does. `clearLocal` runs even if removal failed, and `endSession` runs even if `clearLocal` threw
 * (the person asked to sign out), after which the error is rethrown.
 */
export async function signOutPhone(
  steps: SignOutSteps,
  options: { timeoutMs?: number } = {},
): Promise<RemoveOutcome> {
  const outcome = await removeWithin(steps.removeClient, options.timeoutMs ?? REMOVE_CLIENT_TIMEOUT_MS);
  let localError: unknown = null;
  try {
    await steps.clearLocal();
  } catch (error) {
    localError = error;
  }
  await steps.endSession();
  if (localError !== null) throw localError;
  return outcome;
}
