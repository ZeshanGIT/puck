import { PUSH_CHANNEL_ID } from "@puck/shared";
import { Platform } from "react-native";

type NotificationsModule = typeof import("expo-notifications");

export async function loadNotificationsModule(): Promise<NotificationsModule | null> {
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

export async function readNotificationPermission(): Promise<"granted" | "denied" | "unknown"> {
  const Notifications = await loadNotificationsModule();
  if (!Notifications || Platform.OS !== "android") return "unknown";
  const settings = await Notifications.getPermissionsAsync();
  if (settings.status === "granted") return "granted";
  if (settings.status === "denied") return "denied";
  return "unknown";
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotificationsModule();
  if (!Notifications || Platform.OS !== "android") return false;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: "Alerts",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return true;
  const next = await Notifications.requestPermissionsAsync();
  return next.status === "granted";
}

export async function registerPushTokenWithConvex(
  Notifications: NotificationsModule,
  register: (token: string) => Promise<void>,
): Promise<boolean> {
  const granted = await ensureNotificationPermission();
  if (!granted) return false;
  const device = await Notifications.getDevicePushTokenAsync();
  const token = typeof device.data === "string" ? device.data : null;
  if (token) await register(token);
  return true;
}

/** Notification permission for the O2 row. `canAskAgain` is false after a denial Android will not repeat. */
export async function readNotificationRowState(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const Notifications = await loadNotificationsModule();
  if (!Notifications || Platform.OS !== "android") return { granted: false, canAskAgain: false };
  const settings = await Notifications.getPermissionsAsync();
  return { granted: settings.status === "granted", canAskAgain: settings.canAskAgain };
}
