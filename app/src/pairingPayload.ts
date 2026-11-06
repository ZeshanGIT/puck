import { BOT_ID_PATTERN, PAIRING_KIND } from "@puck/shared";
import { notificationData } from "./dismissPayload";
import { requestedColour } from "./pairingModel";
import type { PaletteName } from "./ui/botTheme";

/** The data-only pairing push (N7): `{kind: "pairing", botId, botName, colour?, addedFrom?}`, no code. */
export interface PairingPush {
  botId: string;
  botName: string;
  colour: PaletteName | null;
  addedFrom: string | null;
}

/**
 * Reads the pairing push, in any of the shapes `fullscreenAlert` accepts (including the JSON
 * string Expo hands the background task). Null for anything else, or a push with no usable bot.
 */
export function pairingPush(payload: unknown): PairingPush | null {
  const data = notificationData(payload);
  if (!data || data.kind !== PAIRING_KIND) return null;
  const { botId, botName, colour, addedFrom } = data;
  if (typeof botId !== "string" || !BOT_ID_PATTERN.test(botId)) return null;
  if (typeof botName !== "string" || botName.trim() === "") return null;
  return {
    botId,
    botName,
    colour: typeof colour === "string" ? requestedColour(colour) : null,
    addedFrom: typeof addedFrom === "string" && addedFrom.trim() !== "" ? addedFrom : null,
  };
}

/** The bot id on a pairing notification the phone drew and he tapped (its `data` is what we posted). */
export function pairingBotIdFromNotificationData(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as { kind?: unknown; botId?: unknown };
  if (record.kind !== PAIRING_KIND) return null;
  return typeof record.botId === "string" && BOT_ID_PATTERN.test(record.botId) ? record.botId : null;
}

/** What the shade shows: no code (that is read inside the app), just who and from where. */
export function pairingNotificationCopy(push: PairingPush): { title: string; body: string } {
  return {
    title: `${push.botName} wants to page you`,
    body: push.addedFrom ? `From ${push.addedFrom}. Tap to check the code and approve.` : "Tap to check the code and approve.",
  };
}

/** The notification's id and tag, so a repeat replaces it and approving or rejecting can remove it. */
export function pairingNotificationId(botId: string): string {
  return `pairing-${botId}`;
}
