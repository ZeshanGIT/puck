// Pure rules for a bot's owner settings (B1, B2): mute, colour, and the waiting count on the
// bot list. No database access here, so backend/test can run them directly.

import { BOT_COLOURS, type BotColour } from "@puck/shared";
import { isWaiting } from "./alertHistory";

/** True while a mute is in force. A mute that ends exactly now is over. */
export function isMuted(mutedUntil: number | undefined, now: number): boolean {
  return mutedUntil !== undefined && mutedUntil > now;
}

/**
 * How an alert from this bot reaches the phone. A muted bot's alert is stored and listed under
 * Needs you, but is not pushed, so it makes no sound, heads-up or full-screen ring, urgent or not.
 */
export function alertPushMode(bot: { mutedUntil?: number }, now: number): "push" | "muted" {
  return isMuted(bot.mutedUntil, now) ? "muted" : "push";
}

export function validateBotColour(value: unknown): BotColour {
  if (typeof value !== "string" || !(BOT_COLOURS as readonly string[]).includes(value)) {
    throw new Error(`colour must be one of: ${BOT_COLOURS.join(", ")}`);
  }
  return value as BotColour;
}

/** A mute time in the future (epoch ms), or null to unmute. */
export function validateMutedUntil(value: unknown, now: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= now) {
    throw new Error("mutedUntil must be a time in the future, or null to unmute");
  }
  return value;
}

/**
 * Waiting alerts per bot id, counted from one bounded read of pending and snoozed alerts. An
 * alert past its expiry is not counted.
 */
export function tallyWaiting(
  alerts: ReadonlyArray<{ botId: string; status: "pending" | "scheduled" | "answered" | "cancelled" | "snoozed"; expiresAt?: number }>,
  now: number,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const alert of alerts) {
    if (!isWaiting(alert.status, alert.expiresAt ?? null, now)) continue;
    counts.set(alert.botId, (counts.get(alert.botId) ?? 0) + 1);
  }
  return counts;
}
