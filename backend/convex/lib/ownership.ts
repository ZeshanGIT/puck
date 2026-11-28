// Pure rules for who owns an alert (docs/multi-user.md). No Convex imports, so `bun test` can run them.
//
// The owner of an alert is, in order: `alert.userId` when it is set; else the bot's `userId`; for
// the built-in Puck bot (ownerless by design, used for test pages aimed at one client) the user of
// the target client. An alert with no resolvable owner has owner `null`: no signed-in client may
// see it (fail closed). Only the legacy device (one phone, device JWT) may see ownerless alerts.

export interface OwnerBot {
  userId?: string | null;
  builtIn?: boolean | null;
}

export interface OwnerInput {
  /** `alert.userId`, once the alert has one. */
  alertUserId?: string | null;
  /** The alert's bot row, or null when it is gone. */
  bot: OwnerBot | null;
  /** The `userId` of the client named by `alert.targetClientId`, when there is one and it exists. */
  targetClientUserId?: string | null;
}

/** The Clerk user id that owns the alert, or null when nobody can be named. */
export function deriveAlertOwner(input: OwnerInput): string | null {
  if (input.alertUserId) return input.alertUserId;
  const bot = input.bot;
  if (!bot) return null;
  if (bot.builtIn === true) return input.targetClientUserId || null;
  return bot.userId || null;
}

/** Who is asking: a signed-in user, or the legacy device (one phone, device JWT). */
export type Viewer = { kind: "user"; userId: string } | { kind: "device" };

/** Whether this viewer may see, answer or change an alert with this owner. */
export function ownerMayAccess(owner: string | null, viewer: Viewer): boolean {
  if (viewer.kind === "device") return owner === null;
  return owner !== null && owner === viewer.userId;
}
