import * as IntentLauncher from "expo-intent-launcher";

/**
 * Opens Android's Do Not Disturb access screen. There is no JS API for
 * `NotificationManager.isNotificationPolicyAccessGranted` in our dependencies, so the app cannot
 * tell whether the person turned it on; O2 treats the row as asked when they come back.
 * Real detection needs a small native module.
 */
export async function openDndAccessSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.NOTIFICATION_POLICY_ACCESS_SETTINGS);
}
