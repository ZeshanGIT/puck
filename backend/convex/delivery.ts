import { DELIVERY_MAX_ATTEMPTS, buildAnswerPayload, buildSnoozedPayload, deliveryBackoffMs } from "@puck/shared";
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
    // The client that answered, when the answer came through a signed-in client.
    const answeredBy = alert.answeredByClientId ? await ctx.db.get(alert.answeredByClientId) : null;
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
      client: answeredBy?.name ?? null,
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
    await ctx.db.patch(answer._id, { deliveryStatus: "delivered", lastError: undefined, deliveredAt: Date.now() });
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

type WebhookResult = { ok: true } | { ok: false; error: string; retry: boolean };

/** POST one JSON body to a bot's webhook. Shared by answers and snoozed events. */
async function postWebhook(webhookUrl: string, webhookHeader: string, body: string): Promise<WebhookResult> {
  try {
    const authorization = await decryptHeader(webhookHeader);
    const response = await fetch(webhookUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body,
    });
    if (!response.ok) return { ok: false, error: `webhook responded HTTP ${response.status}`, retry: true };
    return { ok: true };
  } catch (error) {
    const decryptFailed = error instanceof CryptoError;
    return {
      ok: false,
      error: decryptFailed ? "could not decrypt the webhook header" : "webhook request failed",
      retry: !decryptFailed,
    };
  }
}

/** POST the answer payload. Retries are scheduled by `fail` with backoff. */
export const deliver = internalActionGeneric({
  args: { answerId: v.id("answers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runMutation(internal.delivery.begin, { answerId: args.answerId });
    if (!job.proceed) return null;
    const result = await postWebhook(job.webhookUrl, job.webhookHeader, job.body);
    if (result.ok) {
      await ctx.runMutation(internal.delivery.complete, { answerId: args.answerId });
    } else {
      await ctx.runMutation(internal.delivery.fail, {
        answerId: args.answerId,
        error: result.error,
        retry: result.retry,
      });
    }
    return null;
  },
});

/* ------------------------------------------------------------ snoozed events */

/** Claim one delivery attempt of a snoozed event, like `begin` does for an answer. */
export const beginSnooze = internalMutationGeneric({
  args: { eventId: v.id("snoozeEvents") },
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
    const event = await ctx.db.get(args.eventId);
    if (!event || event.deliveryStatus !== "pending") return { proceed: false as const };
    if (event.deliveryAttempts >= DELIVERY_MAX_ATTEMPTS) {
      await ctx.db.patch(event._id, { deliveryStatus: "failed" });
      return { proceed: false as const };
    }
    const attempts = event.deliveryAttempts + 1;
    const alert = await ctx.db.get(event.alertId);
    const bot = alert ? await ctx.db.get(alert.botId) : null;
    if (!alert || !bot) {
      await ctx.db.patch(event._id, {
        deliveryAttempts: attempts,
        deliveryStatus: "failed",
        lastError: "alert is missing its bot",
      });
      return { proceed: false as const };
    }
    if (deliveryRoute(bot) === "built-in") {
      // The built-in Puck bot has no webhook. Nothing is sent, so no attempt is counted.
      await ctx.db.patch(event._id, { deliveryStatus: "delivered" });
      return { proceed: false as const };
    }
    await ctx.db.patch(event._id, { deliveryAttempts: attempts });
    const client = event.clientId ? await ctx.db.get(event.clientId) : null;
    const payload = buildSnoozedPayload({
      questionId: alert.questionId,
      question: alert.question,
      bot: bot.name,
      routine: bot.routine,
      priority: alert.priority,
      snoozedUntil: event.snoozedUntil,
      client: client?.name ?? null,
    });
    return {
      proceed: true as const,
      webhookUrl: bot.webhookUrl,
      webhookHeader: bot.webhookHeader,
      body: JSON.stringify(payload),
    };
  },
});

export const completeSnooze = internalMutationGeneric({
  args: { eventId: v.id("snoozeEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.deliveryStatus !== "pending") return null;
    await ctx.db.patch(event._id, { deliveryStatus: "delivered", lastError: undefined });
    return null;
  },
});

export const failSnooze = internalMutationGeneric({
  args: {
    eventId: v.id("snoozeEvents"),
    error: v.string(),
    retry: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.deliveryStatus !== "pending") return null;
    const delay = args.retry ? deliveryBackoffMs(event.deliveryAttempts) : null;
    const lastError = args.error.slice(0, 200);
    if (delay === null) {
      await ctx.db.patch(event._id, { deliveryStatus: "failed", lastError });
      return null;
    }
    await ctx.db.patch(event._id, { lastError });
    await ctx.scheduler.runAfter(delay, internal.delivery.deliverSnooze, { eventId: event._id });
    return null;
  },
});

/** POST the snoozed event (Q17). Same four tries and backoff as an answer. */
export const deliverSnooze = internalActionGeneric({
  args: { eventId: v.id("snoozeEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runMutation(internal.delivery.beginSnooze, { eventId: args.eventId });
    if (!job.proceed) return null;
    const result = await postWebhook(job.webhookUrl, job.webhookHeader, job.body);
    if (result.ok) {
      await ctx.runMutation(internal.delivery.completeSnooze, { eventId: args.eventId });
    } else {
      await ctx.runMutation(internal.delivery.failSnooze, {
        eventId: args.eventId,
        error: result.error,
        retry: result.retry,
      });
    }
    return null;
  },
});
