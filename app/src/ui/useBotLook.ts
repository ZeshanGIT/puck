import { useMemo, useSyncExternalStore } from "react";
import type { BlobBot } from "./blobShapes";
import { botLook, type BotLookInput } from "./botLook";
import { botLooksVersion, subscribeBotLooks } from "./botLookStore";

/** `botLook`, drawn again when the bot's chosen colour or shape changes (its page, or another phone). */
export function useBotLook({ botId, botName, colour, shape }: BotLookInput): BlobBot {
  const version = useSyncExternalStore(subscribeBotLooks, botLooksVersion);
  return useMemo(() => {
    void version; // a changed look draws again
    return botLook({ botId, botName, ...(colour === undefined ? {} : { colour }), ...(shape === undefined ? {} : { shape }) });
  }, [botId, botName, colour, shape, version]);
}
