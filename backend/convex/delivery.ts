import { DELIVERY_MAX_ATTEMPTS, buildAnswerPayload, deliveryBackoffMs } from "@puck/shared";
import { internalActionGeneric, internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { payloadAttachment } from "./lib/attachments";
import { deliveryRoute } from "./lib/builtInBot";
import { CryptoError, decryptHeader } from "./lib/crypto";

/** Claim one delivery attempt and return the webhook call, or report that nothing should be sent. */
export const begin = internalMutationGeneric({
  args: { answerId: v.id("answers") },
  returns: v.union(
    v.object({ proceed: v.literal(false) }),
    v.object({
      proceed: v.literal(true),
      webhookUrl: v.string(),
      webhookHeader: v.string(),
      body: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const answer = await ctx.db.get(args.answerId);
    if (!answer || answer.deliveryStatus !== "pending") return { proceed: false as const };
    if (answer.deliveryAttempts >= DELIVERY_MAX_ATTEMPTS) {
      await ctx.db.patch(answer._id, { deliveryStatus: "failed" });
      return { proceed: false as const };
    }
    const attempts = answer.deliveryAttempts + 1;
    const alert = await ctx.db.get(answer.alertId);
    const bot = alert ? await ctx.db.get(alert.botId) : null;
    if (alert && bot && deliveryRoute(bot) === "built-in") {
      // The built-in Puck bot has no webhook. Nothing is sent, so no attempt is counted.
      await ctx.db.patch(answer._id, { deliveryStatus: "delivered" });
      return { proceed: false as const };
    }
    if (!alert || !bot) {
      await ctx.db.patch(answer._id, {
        deliveryAttempts: attempts,
        deliveryStatus: "failed",
        lastError: "alert is missing its bot",
      });
      return { proceed: false as const };
    }
    await ctx.db.patch(answer._id, { deliveryAttempts: attempts });
    const payload = buildAnswerPayload({
      questionId: alert.questionId,
      question: alert.question,
      bot: bot.name,
      routine: bot.routine,
      priority: alert.priority,
      answers: answer.answers,
      customReply: answer.customReply,
      answeredAt: answer.answeredAt,
      source: answer.source,
    });
    // Storage URLs are made now, so a retry sends fresh ones. Added only when the reply has files,
    // which keeps v0 payloads identical.
    const attachments = [];
    for (const item of answer.attachments ?? []) {
      const url = await ctx.storage.getUrl(item.storageId);
      if (!url) {
        await ctx.db.patch(answer._id, {
          deliveryStatus: "failed",
          lastError: `attachment ${item.name} is no longer in storage`,
        });
        return { proceed: false as const };
      }
      attachments.push(payloadAttachment(item, url));
    }
    return {
      proceed: true as const,
      webhookUrl: bot.webhookUrl,
      webhookHeader: bot.webhookHeader,
      body: JSON.stringify(attachments.length > 0 ? { ...payload, attachments } : payload),
    };
  },
});

export const complete = internalMutationGeneric({
  args: { answerId: v.id("answers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const answer = await ctx.db.get(args.answerId);
    if (!answer || answer.deliveryStatus !== "pending") return null;
    // Patch, not replace, so the answer keeps its attachments. Undefined clears `lastError`.
    await ctx.db.patch(answer._id, { deliveryStatus: "delivered", lastError: undefined });
    return null;
  },
});

export const fail = internalMutationGeneric({
  args: {
    answerId: v.id("answers"),
    error: v.string(),
    retry: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const answer = await ctx.db.get(args.answerId);
    if (!answer || answer.deliveryStatus !== "pending") return null;
    const delay = args.retry ? deliveryBackoffMs(answer.deliveryAttempts) : null;
    const lastError = args.error.slice(0, 200);
    if (delay === null) {
      await ctx.db.patch(answer._id, { deliveryStatus: "failed", lastError });
      return null;
    }
    await ctx.db.patch(answer._id, { lastError });
    await ctx.scheduler.runAfter(delay, internal.delivery.deliver, { answerId: answer._id });
    return null;
  },
});

/** POST the answer payload. Retries are scheduled by `fail` with backoff. */
export const deliver = internalActionGeneric({
  args: { answerId: v.id("answers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runMutation(internal.delivery.begin, { answerId: args.answerId });
    if (!job.proceed) return null;
    try {
      const authorization = await decryptHeader(job.webhookHeader);
      const response = await fetch(job.webhookUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "content-type": "application/json",
          authorization,
        },
        body: job.body,
      });
      if (!response.ok) {
        await ctx.runMutation(internal.delivery.fail, {
          answerId: args.answerId,
          error: `webhook responded HTTP ${response.status}`,
          retry: true,
        });
        return null;
      }
      await ctx.runMutation(internal.delivery.complete, { answerId: args.answerId });
      return null;
    } catch (error) {
      const decryptFailed = error instanceof CryptoError;
      await ctx.runMutation(internal.delivery.fail, {
        answerId: args.answerId,
        error: decryptFailed ? "could not decrypt the webhook header" : "webhook request failed",
        retry: !decryptFailed,
      });
      return null;
    }
  },
});
