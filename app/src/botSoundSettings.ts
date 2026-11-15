import { pickRingtone } from "puck-full-screen";
import { followAppFor, loadLocalSettings, ringtonesInUse, saveBotBypass, saveLocalSettings } from "./localSettings";
import { staleRingChannelIds } from "./ringChannels";

/** Which sound row was tapped. */
export type SoundKind = "normal" | "urgent";

/** What the system picker returns for "Default ringtone": stored as empty, so the phone's own ringtone is followed. */
const DEFAULT_RINGTONE_URI = "content://settings/system/ringtone";

/**
 * Deletes the ringing channels made for a ringtone that is no longer in use, by the global choices
 * or by any bot. Android fixes a channel's sound when it is created, so each ringtone has its own
 * channels (`ringChannels.ts`). Never throws: a leftover channel only clutters Android's settings.
 */
export async function removeStaleRingChannels(): Promise<void> {
  try {
    const notifee = (await import("@notifee/react-native")).default;
    const channels = await notifee.getChannels();
    const stale = staleRingChannelIds(
      channels.map((channel) => channel.id),
      ringtonesInUse(await loadLocalSettings()),
    );
    for (const id of stale) await notifee.deleteChannel(id);
  } catch {
    // Nothing to clean, or Notifee is not available here.
  }
}

/**
 * Opens the system ringtone picker for normal or urgent alerts and keeps the choice on the phone:
 * the global one, or one bot's own when `botId` is given. Clears the channels of the one it
 * replaces. Backing out of the picker changes nothing. The next alert rings with the new ringtone.
 * Returns false when the picker could not open.
 */
export async function chooseRingtone(kind: SoundKind, botId?: string): Promise<boolean> {
  try {
    const settings = await loadLocalSettings();
    const own = botId === undefined ? undefined : settings.bots[botId];
    const current =
      kind === "urgent"
        ? (own?.urgentRingtone ?? settings.urgentRingtone)
        : (own?.normalRingtone ?? settings.normalRingtone);
    const picked = await pickRingtone(current);
    if (picked === null) return true;
    const uri = picked === DEFAULT_RINGTONE_URI ? "" : picked;
    if (botId === undefined) {
      if (uri !== current) await saveLocalSettings(kind === "urgent" ? { urgentRingtone: uri } : { normalRingtone: uri });
    } else if (uri !== current) {
      await saveBotBypass(botId, kind === "urgent" ? { urgentRingtone: uri } : { normalRingtone: uri });
    }
    await removeStaleRingChannels();
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes a bot follow app settings again for this kind of alert: the ringtone, Repeat, card or full
 * screen, reminders, and Do Not Disturb and silent mode (for this kind only; the other kind keeps
 * the bot's own choice).
 */
export async function resetBotSound(botId: string, kind: SoundKind): Promise<void> {
  const settings = await loadLocalSettings();
  const own = settings.bots[botId];
  await saveBotBypass(botId, {
    ...(kind === "urgent"
      ? { urgentRingtone: null, loopUrgent: null, fullScreenUrgent: null, reminderMinutes: null }
      : { normalRingtone: null, loopNormal: null, fullScreenNormal: null, reminderMinutesNormal: null }),
    dnd: followAppFor(own?.dnd, settings.bypassDnd, kind),
    silent: followAppFor(own?.silent, settings.bypassSilent, kind),
  });
  await removeStaleRingChannels();
}
