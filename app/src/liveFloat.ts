/**
 * The floating card for live tasks, for the bots the person turned it on for (their page in Bots).
 * Called with every live-activity push, after the shade notification: it shows or updates the card,
 * or takes it away when the setting is off. The card itself (`LiveFloat` in the native module)
 * remembers where it sits and what the person hid.
 */
import { canDrawOverlay, hideLiveFloat, showLiveFloat } from "puck-full-screen";
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
