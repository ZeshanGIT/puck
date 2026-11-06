// Pure rules for pairing requests (Protocol changes sections 4 and 5). No database access here.

export type PairingStatus = "pending" | "paired" | "rejected" | "expired" | "not_found";

/** The fields of a bots row that the pairing rules read. */
export interface PairingBot {
  pairingState: "pending" | "paired";
  rejectedAt?: number;
  pairingCodeExpiresAt?: number;
  userId?: string;
}

/** What the CLI sees when it asks about its request. Rejection wins over the expiry clock. */
export function pairingStatusOf(bot: PairingBot, now: number): Exclude<PairingStatus, "not_found"> {
  if (bot.rejectedAt !== undefined) return "rejected";
  if (bot.pairingState === "paired") return "paired";
  if (bot.pairingCodeExpiresAt === undefined || bot.pairingCodeExpiresAt < now) return "expired";
  return "pending";
}

/** A request the owner can still approve or reject: pending, not rejected, not expired, theirs. */
export function isOpenRequestFor(bot: PairingBot, userId: string, now: number): boolean {
  return pairingStatusOf(bot, now) === "pending" && bot.userId === userId;
}

/** Whether a pending bot counts against the pending cap (rejected requests do not). */
export function countsTowardPendingCap(bot: { pairingState: "pending" | "paired"; rejectedAt?: number }): boolean {
  return bot.pairingState === "pending" && bot.rejectedAt === undefined;
}
