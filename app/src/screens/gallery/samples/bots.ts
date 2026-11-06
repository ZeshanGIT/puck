/**
 * Samples for the Bots screens (B1, B2), with no backend: `puck://dev-alert?sample=<name>` (dev
 * builds only, see `App.tsx`). They run the real screens (`BotsHost`) on fake bots; mute, colour,
 * Do Not Disturb and silent overrides and Remove all work on the fake data.
 *
 * - `bots`: B1 with a few bots: Deploy Watch with two waiting, Sheldon paged recently, Brow muted
 *   until tomorrow, Cortana that never paged him.
 * - `bots-empty`: B1 with no bots (the empty state and Pair a bot).
 * - `bot`: B2 for Sheldon (coral, not muted).
 * - `bot-muted`: B2 for Brow, muted until tomorrow morning, with a Do Not Disturb override.
 *
 * Times are relative to the moment a sample is opened; `freshBots` turns them into real times.
 */
import { muteUntil, type BotListItem } from "../../../botsModel";
import type { BotBypass } from "../../../localSettings";
import type { BotsStart } from "../../BotsHost";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const BOTS_SAMPLE_NAMES = ["bots", "bots-empty", "bot", "bot-muted"] as const;

export function isBotsSample(name: string): boolean {
  return (BOTS_SAMPLE_NAMES as readonly string[]).includes(name);
}

export interface BotsSample {
  bots: BotListItem[];
  bypass: Record<string, BotBypass>;
  start: BotsStart;
}

function fewBots(now: number): BotListItem[] {
  return [
    {
      botId: "sheldon-23648",
      name: "Sheldon",
      colour: "coral",
      mutedUntil: null,
      createdAt: now - 20 * DAY,
      addedFrom: "MacBook",
      lastAlertAt: now - 12 * MINUTE,
      waitingCount: 0,
    },
    {
      botId: "deploy-watch-04417",
      name: "Deploy Watch",
      colour: "teal",
      mutedUntil: null,
      createdAt: now - 9 * DAY,
      addedFrom: "build-server",
      lastAlertAt: now - 3 * MINUTE,
      waitingCount: 2,
    },
    {
      botId: "brow-00007",
      name: "Brow",
      colour: "violet",
      mutedUntil: muteUntil("tomorrow", now),
      createdAt: now - 6 * DAY,
      addedFrom: "MacBook",
      lastAlertAt: now - 5 * HOUR,
      waitingCount: 0,
    },
    {
      botId: "cortana-00042",
      name: "Cortana",
      colour: "indigo",
      mutedUntil: null,
      createdAt: now - 1 * DAY,
      addedFrom: null,
      lastAlertAt: null,
      waitingCount: 0,
    },
  ];
}

/** The named sample, or null for an unknown name. */
export function freshBots(name: string, now: number = Date.now()): BotsSample | null {
  switch (name) {
    case "bots":
      return { bots: fewBots(now), bypass: {}, start: { kind: "list" } };
    case "bots-empty":
      return { bots: [], bypass: {}, start: { kind: "list" } };
    case "bot":
      return { bots: fewBots(now), bypass: {}, start: { kind: "bot", botId: "sheldon-23648" } };
    case "bot-muted":
      return {
        bots: fewBots(now),
        bypass: { "brow-00007": { dnd: "all" } },
        start: { kind: "bot", botId: "brow-00007" },
      };
    default:
      return null;
  }
}
