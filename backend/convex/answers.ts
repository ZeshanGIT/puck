import {
  AlertValidationError,
  decideAlert,
  receiptState,
  resolveAnsweredAt,
  validateAnswer,
  validateAttachments,
  validateSnoozeUntil,
} from "@puck/shared";
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireDevice } from "./device";
import { assertDistinctStorageIds, reconcileAttachment } from "./lib/attachments";
import { requireClient } from "./lib/clientAuth";
import { decideRetry } from "./lib/deliveryRetry";
import { alertIsForClient } from "./lib/pushTargets";
import { storedAttachment } from "./schema";

const RECEIPT_STATES = v.union(v.literal("pending"), v.literal("sent"), v.literal("delivered"), v.literal("failed"));

/**
 * Records Seshan's reply and schedules the webhook POST.
 * With `clientId` the caller is that signed-in client (Clerk identity) and the alert stores it.
 * Without it the caller must be the claimed device (the legacy path).
 * `attachments` are files already uploaded with `files.generateUploadUrl`: at most 5, each at most
 * 20 MB by the size Convex stored (the declared size is not trusted). They can stand alone.
 */
export const record = mutationGeneric({
  args: {
    questionId: v.string(),
    optionIds: v.array(v.string()),
    customReply: v.optional(v.string()),
    clientId: v.optional(v.string()),
    attachments: v.optional(v.array(storedAttachment)),
    // When the phone's answer was given, for one that waited offline. Used only when it is not in
    // the future and at most 24 hours old (`resolveAnsweredAt`); otherwise the server's time is.
    answeredAt: v.optional(v.number()),
  },
  returns: v.object({ questionId: v.string() }),
  handler: async (ctx, args) => {
    const client = args.clientId === undefined ? null : await requireClient(ctx, args.clientId);
    if (!client) await requireDevice(ctx);
    const alert = await ctx.db
      .query("alerts")
      .withIndex("by_questionId", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (!alert) throw new Error("alert not found");
    const decision = decideAlert(alert.status, { type: "answer" });
    if (decision.rejection !== null) throw new Error(decision.rejection);
    const now = Date.now();
    const answeredAt = resolveAnsweredAt(args.answeredAt, now);
    // Past `expiresAt` the alert is Missed and can't be answered (an answer given in time that
    // comes back late from the phone's queue still counts, by its own time).
    if (alert.expiresAt !== undefined && answeredAt > alert.expiresAt) throw new Error("alert has expired");

    let recorded;
    let declared;
    try {
      declared = validateAttachments(
        args.attachments?.map(({ storageId: _storageId, ...meta }) => meta),
      );
      recorded = validateAnswer({
        selectionMode: alert.selectionMode,
        options: alert.options,
        optionIds: args.optionIds,
        customReply: args.customReply,
        hasAttachments: declared.length > 0,
      });
    } catch (error) {
      if (error instanceof AlertValidationError) throw new Error(error.message);
      throw error;
    }

    let attachments;
    if (args.attachments && args.attachments.length > 0) {
      assertDistinctStorageIds(args.attachments.map((item) => item.storageId));
      attachments = [];
      for (const [index, item] of args.attachments.entries()) {
        const stored = await ctx.db.system.get("_storage", item.storageId);
        const meta = reconcileAttachment(declared[index]!, stored, index);
        attachments.push({ storageId: item.storageId, ...meta });
      }
    }

    const answerId = await ctx.db.insert("answers", {
      alertId: alert._id,
      questionId: alert.questionId,
      answers: recorded.answers,
      customReply: recorded.customReply,
      source: "app",
      answeredAt,
      deliveryStatus: "pending",
      deliveryAttempts: 0,
      ...(attachments ? { attachments } : {}),
    });
    await ctx.db.patch(alert._id, {
      status: decision.status,
      updatedAt: now,
      ...(client ? { answeredByClientId: client._id } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.delivery.deliver, { answerId });
    // Every other client drops its copy of the alert ("answered elsewhere", A9).
    await ctx.scheduler.runAfter(0, internal.push.sendDismiss, {
      questionId: alert.questionId,
      ...(client ? { exceptClientId: client._id as string } : {}),
    });
    return { questionId: alert.questionId };
  },
});

/**
 * Snoozes an alert (A11, Q17). `until` is epoch ms in the next 24 hours, or null for "until I'm
 * back". The alert goes to `snoozed` (so `alerts.pending` leaves it out), the bot's webhook gets
 * a `snoozed` event, and a timed snooze is released by the scheduler at `until` with a push like
 * a new alert. A pending alert can be snoozed, and so can a snoozed one (a later snooze replaces
 * the first; the first one's release does nothing). Other clients drop their copy.
 */
export const snooze = mutationGeneric({
  args: {
    clientId: v.string(),
    questionId: v.string(),
    until: v.union(v.number(), v.null()),
  },
  returns: v.object({ questionId: v.string(), snoozedUntil: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const alert = await ctx.db
      .query("alerts")
      .withIndex("by_questionId", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (!alert) throw new Error("alert not found");
    const decision = decideAlert(alert.status, { type: "snooze" });
    if (decision.rejection !== null) throw new Error(decision.rejection);
    const now = Date.now();
    let until: number | null;
    try {
      until = validateSnoozeUntil(args.until, now);
    } catch (error) {
      if (error instanceof AlertValidationError) throw new Error(error.message);
      throw error;
    }
    await ctx.db.patch(alert._id, {
      status: decision.status,
      updatedAt: now,
      snoozedUntil: until ?? undefined,
      snoozedByClientId: client._id,
    });
    const eventId = await ctx.db.insert("snoozeEvents", {
      alertId: alert._id,
      questionId: alert.questionId,
      snoozedUntil: until,
      snoozedAt: now,
      clientId: client._id,
      deliveryStatus: "pending",
      deliveryAttempts: 0,
    });
    await ctx.scheduler.runAfter(0, internal.delivery.deliverSnooze, { eventId });
    if (until !== null) {
      await ctx.scheduler.runAt(until, internal.alerts.releaseSnoozed, {
        alertId: alert._id,
        snoozedUntil: until,
      });
    }
    await ctx.scheduler.runAfter(0, internal.push.sendDismiss, {
      questionId: alert.questionId,
      exceptClientId: client._id as string,
    });
    return { questionId: alert.questionId, snoozedUntil: until };
  },
});

/**
 * Where an answer is on its way to the bot (A7): `pending` (not stored yet), `sent` (Puck has it),
 * `delivered` (the bot took it), `failed` (a try failed; Puck keeps trying, or gave up). The app
 * reads it to show Sent, then "Delivered to <bot>". Null when the alert does not exist.
 */
export const receipt = queryGeneric({
  args: { clientId: v.string(), questionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ state: RECEIPT_STATES, botName: v.string(), attempts: v.number(), exhausted: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    await requireClient(ctx, args.clientId);
    const alert = await ctx.db
      .query("alerts")
      .withIndex("by_questionId", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (!alert) return null;
    const bot = await ctx.db.get(alert.botId);
    const answer = await ctx.db
      .query("answers")
      .withIndex("by_questionId", (q) => q.eq("questionId", alert.questionId))
      .unique();
    return {
      state: receiptState(answer),
      botName: bot?.name ?? "the bot",
      attempts: answer?.deliveryAttempts ?? 0,
      exhausted: answer?.deliveryStatus === "failed",
    };
  },
});

/**
 * H4 Try again. Only a failed delivery can be retried: a delivered answer needs nothing, and a
 * pending one is already on its way. At most one retry per 10 seconds per answer (`decideRetry`).
 * The attempt count starts again from zero, so the four tries and their backoff run once more.
 * The caller must be a client the alert was sent to; otherwise the answer is "not found".
 */
export const retryDelivery = mutationGeneric({
  args: { clientId: v.string(), answerId: v.id("answers") },
  returns: v.object({ answerId: v.string(), deliveryStatus: v.literal("pending") }),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const answer = await ctx.db.get(args.answerId);
    if (!answer) throw new Error("answer not found");
    const alert = await ctx.db.get(answer.alertId);
    if (!alert || !alertIsForClient(alert.targetClientId, client._id)) throw new Error("answer not found");
    const now = Date.now();
    const decision = decideRetry(
      { deliveryStatus: answer.deliveryStatus, lastRetryAt: answer.lastRetryAt ?? null },
      now,
    );
    if (decision.action === "refuse") throw new Error(decision.message);
    await ctx.db.patch(answer._id, {
      deliveryStatus: "pending",
      deliveryAttempts: 0,
      lastError: undefined,
      deliveredAt: undefined,
      lastRetryAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.delivery.deliver, { answerId: answer._id });
    return { answerId: answer._id as string, deliveryStatus: "pending" as const };
  },
});
