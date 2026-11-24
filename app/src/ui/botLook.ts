import { botLook as resolveBotLook, type BotLookInput } from "@puck/appearance";
import { knownLook } from "./botLookStore";

export type { BotLookInput } from "@puck/appearance";

export function botLook(bot: BotLookInput) {
  return resolveBotLook(bot, knownLook(bot.botId));
}
