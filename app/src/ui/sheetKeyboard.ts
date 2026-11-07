/** Keyboard lift for bottom sheets in a full-screen Modal (Android does not resize the window). */

export function sheetKeyboardBottomInset(keyboardHeight: number, enabled: boolean): number {
  if (!enabled || keyboardHeight <= 0) return 0;
  return keyboardHeight;
}

/** Cap sheet height when the keyboard is open so inner ScrollViews can scroll. */
export function sheetMaxHeightWhenKeyboardOpen(
  windowHeight: number,
  keyboardBottomInset: number,
  enabled: boolean,
  /** Space left above the sheet for the scrim / status area. */
  topMargin = 48,
): number | undefined {
  if (!enabled || keyboardBottomInset <= 0) return undefined;
  return Math.max(160, windowHeight - keyboardBottomInset - topMargin);
}
