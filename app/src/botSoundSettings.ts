import { PUSH_CHANNEL_ID } from "@puck/shared";
import { URGENT_CHANNEL } from "./localSettings";

/** Which sound row of B2 was tapped. */
export type SoundKind = "normal" | "urgent";

/**
 * B2's Sound rows open Android's own settings for the channel that plays the sound. There is no
 * channel per bot yet (Protocol changes section 6 plans one per bot and priority, created on its first
 * alert), so both rows open the shared channels: normal alerts, and the plain urgent channel (the
 * one an urgent alert rings on unless it asks to bypass Do Not Disturb or silent mode). Android
 * shows the app's notification settings when a channel does not exist yet. Returns false when it
 * could not open anything.
 */
export async function openSoundSettings(kind: SoundKind): Promise<boolean> {
  try {
    const notifee = (await import("@notifee/react-native")).default;
    await notifee.openNotificationSettings(kind === "urgent" ? URGENT_CHANNEL.plain : PUSH_CHANNEL_ID);
    return true;
  } catch {
    return false;
  }
}
