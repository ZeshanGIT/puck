// One-off data migrations for multi-user (docs/multi-user.md). Internal only: run them from the
// Convex dashboard or `convex run`. None of them deletes a row, each is idempotent, and each takes
// `dryRun` to report what it would change without writing.
//
// Order: backfillBotOwners (for bots paired before owners existed), then backfillAlertOwners
// (loop with the returned `continueCursor` until `isDone`). Release plan: widen, migrate, narrow.

import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { newOwnerCache, alertOwner } from "./lib/alertAccess";

const MAX_BOT_IDS = 100;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 200;

const botSkip = v.object({ botId: v.string(), reason: v.string() });

/**
 * Sets `userId` on the listed ownerless bots (public ids such as `sheldon-23648`) and nothing else.
 * It never overwrites an existing owner and never touches the built-in Puck bot.
 */
export const backfillBotOwners = internalMutationGeneric({
  args: { userId: v.string(), botIds: v.array(v.string()), dryRun: v.boolean() },
  returns: v.object({
    dryRun: v.boolean(),
    updated: v.array(v.string()),
    skipped: v.array(botSkip),
  }),
  handler: async (ctx, args) => {
    const userId = args.userId.trim();
    if (userId === "") throw new Error("userId is required");
    if (args.botIds.length > MAX_BOT_IDS) throw new Error(`at most ${MAX_BOT_IDS} bot ids per call`);
    const updated: string[] = [];
    const skipped: Array<{ botId: string; reason: string }> = [];
    for (const botId of new Set(args.botIds)) {
      const bot = await ctx.db
        .query("bots")
        .withIndex("by_publicId", (q) => q.eq("id", botId))
        .unique();
      if (!bot) {
        skipped.push({ botId, reason: "not found" });
      } else if (bot.builtIn === true) {
        skipped.push({ botId, reason: "built-in bot" });
      } else if (bot.userId !== undefined) {
        skipped.push({ botId, reason: bot.userId === userId ? "already owned by this user" : "already has another owner" });
      } else {
        if (!args.dryRun) await ctx.db.patch(bot._id, { userId });
        updated.push(botId);
      }
    }
    return { dryRun: args.dryRun, updated, skipped };
  },
});

/**
 * Sets `alerts.userId` from the derived owner (the bot's owner, or for built-in test pages the
 * target client's user) on every alert that has none. One page per call: pass the returned
 * `continueCursor` back until `isDone`. Alerts whose owner cannot be resolved are listed in
 * `unresolved` (by question id) and left alone; they stay invisible to every signed-in client.
 */
export const backfillAlertOwners = internalMutationGeneric({
  args: { dryRun: v.boolean(), cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  returns: v.object({
    dryRun: v.boolean(),
    scanned: v.number(),
    alreadyOwned: v.number(),
    updated: v.array(v.string()),
    unresolved: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const numItems = Math.min(MAX_PAGE, Math.max(1, Math.floor(args.numItems ?? DEFAULT_PAGE)));
    const page = await ctx.db.query("alerts").paginate({ cursor: args.cursor ?? null, numItems });
    const cache = newOwnerCache();
    let alreadyOwned = 0;
    const updated: string[] = [];
    const unresolved: string[] = [];
    for (const alert of page.page) {
      if (alert.userId !== undefined) {
        alreadyOwned += 1;
        continue;
      }
      const owner = await alertOwner(ctx, alert, cache);
      if (owner === null) {
        unresolved.push(alert.questionId);
        continue;
      }
      if (!args.dryRun) await ctx.db.patch(alert._id, { userId: owner });
      updated.push(alert.questionId);
    }
    return {
      dryRun: args.dryRun,
      scanned: page.page.length,
      alreadyOwned,
      updated,
      unresolved,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

const REASSIGN_ALERT_BATCH = 500;

/**
 * Moves everything one Clerk user owns to another: their bots (paired and pending, never the
 * built-in bot), the alerts stamped with their `userId`, and their live activities. Clients are
 * left alone (a client belongs to the account that signed in on it). Used on dev to keep every
 * existing bot paging the owner's current account. Reversible by running it the other way with
 * the bot ids it returns. Alerts move in batches: call again until `moreAlerts` is false.
 */
export const reassignOwner = internalMutationGeneric({
  args: { fromUserId: v.string(), toUserId: v.string(), dryRun: v.boolean() },
  returns: v.object({
    dryRun: v.boolean(),
    bots: v.array(v.string()),
    alerts: v.number(),
    moreAlerts: v.boolean(),
    liveActivities: v.number(),
  }),
  handler: async (ctx, args) => {
    const from = args.fromUserId.trim();
    const to = args.toUserId.trim();
    if (from === "" || to === "") throw new Error("fromUserId and toUserId are required");
    if (from === to) throw new Error("fromUserId and toUserId are the same");
    const bots: string[] = [];
    // Every pairing state: the index's first field alone covers paired and pending rows.
    const rows = await ctx.db
      .query("bots")
      .withIndex("by_user_pairing", (q) => q.eq("userId", from))
      .collect();
    for (const bot of rows) {
      if (bot.builtIn === true) continue;
      if (!args.dryRun) await ctx.db.patch(bot._id, { userId: to });
      bots.push(bot.id);
    }
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_user", (q) => q.eq("userId", from))
      .take(REASSIGN_ALERT_BATCH + 1);
    const moving = alerts.slice(0, REASSIGN_ALERT_BATCH);
    if (!args.dryRun) for (const alert of moving) await ctx.db.patch(alert._id, { userId: to });
    const live = await ctx.db
      .query("liveActivities")
      .withIndex("by_user", (q) => q.eq("userId", from))
      .collect();
    if (!args.dryRun) for (const row of live) await ctx.db.patch(row._id, { userId: to });
    return {
      dryRun: args.dryRun,
      bots: bots.sort(),
      alerts: moving.length,
      moreAlerts: alerts.length > REASSIGN_ALERT_BATCH,
      liveActivities: live.length,
    };
  },
});
