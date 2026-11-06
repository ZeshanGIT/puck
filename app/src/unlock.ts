type UnlockAlert = {
  requiresUnlock?: boolean | null;
  options: { id: string; tone?: string | null }[];
};

/**
 * True only when the phone is locked and the answer is sensitive: the alert is marked
 * `requiresUnlock` (every answer, including a custom reply with no option), or any chosen option is
 * destructive. Ordinary options and snoozes never need it.
 */
export function needsUnlock(alert: UnlockAlert, optionIds: string[], locked: boolean): boolean {
  if (!locked) return false;
  if (alert.requiresUnlock === true) return true;
  return optionIds.some((id) => alert.options.find((option) => option.id === id)?.tone === "destructive");
}

/**
 * Call before sending an answer. Resolves when no unlock is needed or the person unlocked. Throws
 * when they cancelled or it failed, so the caller shows a Toast and keeps the screen.
 */
export async function ensureUnlockedFor(alert: UnlockAlert, optionIds: string[]): Promise<void> {
  // Loaded here so the pure rule above can be tested without the native module (expo).
  const { isLocked, requestUnlock } = await import("puck-full-screen");
  if (!needsUnlock(alert, optionIds, isLocked() === true)) return;
  if ((await requestUnlock()) !== "unlocked") throw new Error("Unlock your phone to send this answer");
}
