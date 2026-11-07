/**
 * Helpers for the compact alert card that are not native: whether the system is in dark mode (read
 * without React, for the alert path), and the way to Android's "Display over other apps" page. The
 * card itself and its permission are in `puck-full-screen` (`OverlayCard.kt`). Nothing here grants
 * the permission: only the person can, on that Android page.
 */

const ANDROID_PACKAGE = "in.puckit.app";

/** Whether the system is in dark mode, read without React so the alert path can use it. Never throws. */
export async function systemIsDark(): Promise<boolean> {
  try {
    const { Appearance } = await import("react-native");
    return Appearance.getColorScheme() === "dark";
  } catch {
    return false;
  }
}

/** Opens Android's "Display over other apps" page for Puck. The person switches it on there. */
export async function openOverlaySettings(): Promise<void> {
  const IntentLauncher = await import("expo-intent-launcher");
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_OVERLAY_PERMISSION, {
    data: `package:${ANDROID_PACKAGE}`,
  });
}
