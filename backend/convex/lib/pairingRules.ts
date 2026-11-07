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

/** Why `approvePairing` refuses a code (plain errors for the app and CLI). */
export type ApprovePairingBlock =
  | { kind: "ok_pending" }
  | { kind: "adopt_paired" }
  | { kind: "already_used" }
  | { kind: "expired" }
  | { kind: "wrong_owner" }
  | { kind: "not_found" };

/**
 * Whether the phone may approve this bot with a matching code hash. `adopt_paired` covers bots that
 * paired through the unsigned CLI path (no `userId`) so they can be claimed on a later attempt.
 */
export function approvePairingBlock(
  bot: PairingBot | null,
  callerUserId: string | null,
  now: number,
): ApprovePairingBlock {
  if (!bot) return { kind: "not_found" };
  if (bot.pairingState === "paired") {
    if (callerUserId !== null && bot.userId === undefined) return { kind: "adopt_paired" };
    return { kind: "already_used" };
  }
  if (bot.pairingState !== "pending") return { kind: "not_found" };
  if (callerUserId !== null && bot.userId !== undefined && bot.userId !== callerUserId) {
    return { kind: "wrong_owner" };
  }
  if (bot.pairingCodeExpiresAt === undefined || bot.pairingCodeExpiresAt < now) return { kind: "expired" };
  return { kind: "ok_pending" };
}

export function approvePairingError(block: Exclude<ApprovePairingBlock, { kind: "ok_pending" } | { kind: "adopt_paired" }>): string {
  switch (block.kind) {
    case "already_used":
      return "pairing code was already used";
    case "expired":
      return "pairing code has expired";
    case "wrong_owner":
      return "pairing code is not valid";
    case "not_found":
      return "pairing code is not valid";
  }
}
