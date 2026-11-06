import { AlertValidationError, validateAnswer } from "@puck/shared";
import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireDevice } from "./device";
import { requireClient } from "./lib/clientAuth";

/**
 * Records Seshan's reply and schedules the webhook POST.
 * With `clientId` the caller is that signed-in client (Clerk identity) and the alert stores it.
 * Without it the caller must be the claimed device (the legacy path).
 */
export const record = mutationGeneric({
  args: {
    questionId: v.string(),
    optionIds: v.array(v.string()),
    customReply: v.optional(v.string()),
    clientId: v.optional(v.string()),
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
    if (alert.status === "answered") throw new Error("alert is already answered");
    if (alert.status === "cancelled") throw new Error("alert is cancelled");

    let recorded;
    try {
      recorded = validateAnswer({
        selectionMode: alert.selectionMode,
        options: alert.options,
        optionIds: args.optionIds,
        customReply: args.customReply,
      });
    } catch (error) {
      if (error instanceof AlertValidationError) throw new Error(error.message);
      throw error;
    }

    const answeredAt = Date.now();
    const answerId = await ctx.db.insert("answers", {
      alertId: alert._id,
      questionId: alert.questionId,
      answers: recorded.answers,
      customReply: recorded.customReply,
      source: "app",
      answeredAt,
      deliveryStatus: "pending",
      deliveryAttempts: 0,
    });
    await ctx.db.patch(alert._id, {
      status: "answered",
      updatedAt: answeredAt,
      ...(client ? { answeredByClientId: client._id } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.delivery.deliver, { answerId });
    return { questionId: alert.questionId };
  },
});
