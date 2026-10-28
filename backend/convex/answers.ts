import { AlertValidationError, validateAnswer } from "@puck/shared";
import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Records Seshan's reply and schedules the webhook POST.
 * Public so the app can call it. v0 has no user account yet; the app slice
 * still has to decide how the phone proves it is his.
 */
export const record = mutationGeneric({
  args: {
    questionId: v.string(),
    optionIds: v.array(v.string()),
    customReply: v.optional(v.string()),
  },
  returns: v.object({ questionId: v.string() }),
  handler: async (ctx, args) => {
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
    await ctx.db.patch(alert._id, { status: "answered", updatedAt: answeredAt });
    await ctx.scheduler.runAfter(0, internal.delivery.deliver, { answerId });
    return { questionId: alert.questionId };
  },
});
