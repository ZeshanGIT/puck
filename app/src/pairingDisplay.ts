import notifee, { AndroidImportance } from "@notifee/react-native";
import { PALETTE } from "./ui/botTheme";
import { pairingNotificationCopy, pairingNotificationId, type PairingPush } from "./pairingPayload";

/**
 * N7, the pairing request in the shade. An ordinary notification: it shows up with the bot's name
 * and where it came from, does not ring, and has no action buttons (approving happens in the app,
 * with tap twice). The code is not in it. Tapping it opens B4 (`pairingOpen.ts`).
 *
 * It goes away by itself when the request's code does (15 minutes on the backend), and is removed
 * as soon as the request is approved, rejected or opened.
 */
const PAIRING_CHANNEL_ID = "puck-pairing";
/** The backend's pairing code lives 15 minutes (`PAIRING_TTL_MS`). */
const PAIRING_TIMEOUT_MS = 15 * 60 * 1000;

async function ensurePairingChannel(): Promise<string> {
  await notifee.createChannel({
    id: PAIRING_CHANNEL_ID,
    name: "Pairing requests",
    // Heads-up with the default sound, once: a request he started a moment ago, not an alarm.
    importance: AndroidImportance.HIGH,
  });
  return PAIRING_CHANNEL_ID;
}

export async function displayPairing(push: PairingPush): Promise<void> {
  const channelId = await ensurePairingChannel();
  const copy = pairingNotificationCopy(push);
  const id = pairingNotificationId(push.botId);
  const colour = push.colour === null ? undefined : PALETTE.find((entry) => entry.name === push.colour)?.base;
  await notifee.displayNotification({
    id,
    title: copy.title,
    body: copy.body,
    data: { kind: "pairing", botId: push.botId },
    android: {
      channelId,
      pressAction: { id: "default" },
      tag: id,
      timeoutAfter: PAIRING_TIMEOUT_MS,
      autoCancel: true,
      ...(colour === undefined ? {} : { color: colour }),
    },
  });
}

/** Removes the shade copy of a request that was approved, rejected or opened. Never throws. */
export async function clearPairingNotification(botId: string): Promise<void> {
  const id = pairingNotificationId(botId);
  try {
    await notifee.cancelNotification(id, id);
  } catch {
    // Nothing to remove, or notifications are off. Not worth failing for.
  }
}
