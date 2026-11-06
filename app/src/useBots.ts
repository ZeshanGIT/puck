import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import type { BotListItem } from "./botsModel";

/**
 * The signed-in user's paired bots (`bots.list`): colour, mute, last alert and waiting count.
 * Undefined while they load or with no client id (the legacy device path has no list).
 */
export function useBots(clientId: string | null | undefined): BotListItem[] | undefined {
  return useQuery(anyApi.bots.list, clientId ? { clientId } : "skip") as BotListItem[] | undefined;
}
