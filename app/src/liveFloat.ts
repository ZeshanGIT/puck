/**
 * The floating card for live tasks, for the bots the person turned it on for (their page in Bots).
 * Called with every live-activity push, after the shade notification: it shows or updates the card,
 * or takes it away when the setting is off. The card itself (`LiveFloat` in the native module)
 * remembers where it sits and what the person hid.
 */
import type { Event } from "@notifee/react-native";
import { canDrawOverlay, hideLiveFloat, restoreLiveFloat, showLiveFloat } from "puck-full-screen";
import { liveFloatSpec } from "./liveFloatModel";
import { liveFloatFor, loadLocalSettings } from "./localSettings";
import type { LivePush } from "./livePayload";
import { systemIsDark } from "./overlayCard";
import { requestedColour } from "./pairingModel";
import { botLook } from "./ui/botLook";
import { loadBotLooks } from "./ui/botLookStore";
import { themeIsDark } from "./ui/themePreference";

export async function floatLive(push: LivePush): Promise<void> {
  try {
    const settings = await loadLocalSettings();
    if (!liveFloatFor(settings, push.botId)) {
      hideLiveFloat(push.activityId);
      return;
    }
    if (!canDrawOverlay()) return;
    await loadBotLooks();
    const colour = requestedColour(push.colour);
    const bot = botLook({ botId: push.botId, botName: push.botName, ...(colour === null ? {} : { colour }) });
    const dark = themeIsDark(settings.theme, await systemIsDark());
    showLiveFloat(liveFloatSpec(push, bot, dark));
  } catch {
    // The notification still shows the task.
  }
}

/** The live notification's button that brings the floating card back after it was hidden. */
export const SHOW_FLOAT_ACTION = "live-float-show";
/**
 * The native activity the button opens: it brings the card back without opening Puck. The
 * library's own action event fails in this app, so the JavaScript handler below is only a backup.
 */
export const SHOW_FLOAT_ACTIVITY = "puck.fullscreen.ShowFloatActivity";

/** Whether this bot's live notification carries the "Show floating card" button. */
export async function offersFloat(botId: string): Promise<boolean> {
  try {
    return liveFloatFor(await loadLocalSettings(), botId) && canDrawOverlay();
  } catch {
    return false;
  }
}

/** Handles a tap on "Show floating card"; true when the event was that. */
export function handleFloatAction(event: Pick<Event, "detail">, pressId: string | undefined): boolean {
  if (pressId !== SHOW_FLOAT_ACTION) return false;
  const activityId = event.detail.notification?.data?.activityId;
  restoreLiveFloat(typeof activityId === "string" ? activityId : null);
  return true;
}
