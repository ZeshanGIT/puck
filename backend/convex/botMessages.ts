import { deliveryBackoffMs } from "@puck/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { postWebhook } from "./delivery";
import { BOT_MESSAGE_INTERVAL_MS, botMessageAccess } from "./lib/botMessageRules";

export const enqueue = internalMutation({
  args: { senderId: v.id("bots"), target: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const sender = await ctx.db.get(args.senderId);
    const target = await ctx.db.query("bots").withIndex("by_publicId", (q) => q.eq("id", args.target)).unique();
    const denied = botMessageAccess(sender, target);
    if (denied) return denied;
    if (!sender || !target) throw new Error("bot message authorization invariant");

    const now = Date.now();
    if (now - (sender.lastBotMessageAt ?? 0) < BOT_MESSAGE_INTERVAL_MS) {
      return { status: 429, error: "wait 10 seconds between bot messages" } as const;
    }
    await ctx.db.patch(sender._id, { lastBotMessageAt: now });
    await ctx.scheduler.runAfter(0, internal.botMessages.deliver, {
      senderId: sender._id,
      targetId: target._id,
      body: JSON.stringify({
        event: "bot_message",
        messageId: crypto.randomUUID(),
        sender: { id: sender.id, name: sender.name },
        message: args.message,
        sentAt: new Date(now).toISOString(),
      }),
      attempt: 1,
    });
    return null;
  },
});

const botIds = { senderId: v.id("bots"), targetId: v.id("bots") };

export const destination = internalQuery({
  args: botIds,
  handler: async (ctx, { senderId, targetId }) => {
    const sender = await ctx.db.get(senderId);
    const target = await ctx.db.get(targetId);
    if (!target || botMessageAccess(sender, target)) return null;
    return { url: target.webhookUrl, header: target.webhookHeader };
  },
});

export const deliver = internalAction({
  args: { ...botIds, body: v.string(), attempt: v.number() },
  handler: async (ctx, { senderId, targetId, body, attempt }): Promise<null> => {
    const destination = await ctx.runQuery(internal.botMessages.destination, { senderId, targetId });
    if (!destination) throw new Error("bot message destination is no longer available");
    const result = await postWebhook(destination.url, destination.header, body);
    if (result.ok) {
      console.info(`bot message delivered on attempt ${attempt}`);
      return null;
    }
    const delay = result.retry ? deliveryBackoffMs(attempt) : null;
    if (delay === null) throw new Error(`bot message delivery failed: ${result.error}`);
    await ctx.scheduler.runAfter(delay, internal.botMessages.deliver, {
      senderId, targetId, body, attempt: attempt + 1,
    });
    return null;
  },
});
