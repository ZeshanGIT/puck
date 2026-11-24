import { AlertValidationError, deliveryBackoffMs, validateBotAlert, validateLiveCommand } from "@puck/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { postWebhook } from "./delivery";
import { startBotActivity, updateBotActivity } from "./lib/botActivity";
import { botMessageAccess, takePageToken } from "./lib/botMessageRules";
import { newQuestionId } from "./lib/crypto";
import { isStale } from "./lib/liveRules";

export const enqueue = internalMutation({
  args: { senderId: v.id("bots"), target: v.string(), input: v.string() },
  handler: async (ctx, args) => {
    const sender = await ctx.db.get(args.senderId);
    const target = await ctx.db.query("bots").withIndex("by_publicId", (q) => q.eq("id", args.target)).unique();
    const denied = botMessageAccess(sender, target);
    if (denied) return denied;
    if (!sender || !target) throw new Error("bot page authorization invariant");

    const now = Date.now();
    const bucket = takePageToken(sender.botPageBucket, now);
    if (!bucket) return { status: 429, error: "bot page rate limit reached; retry in a few seconds" } as const;

    const input = JSON.parse(args.input) as { alert?: unknown; activity?: unknown };
    let alertId: string;
    let content;
    try {
      if (Object.keys(input).length !== 1 || (!("alert" in input) && !("activity" in input))) {
        return { status: 400, error: "send alert JSON or a live activity command" } as const;
      }
      if ("alert" in input) {
        const { replyTo, ...alert } = validateBotAlert(input.alert, now);
        alertId = newQuestionId();
        content = { alert, replyTo };
      } else {
        const command = validateLiveCommand(input.activity);
        const row = await ctx.db.query("botActivities")
          .withIndex("by_sender_target", (q) => q.eq("senderId", sender._id).eq("targetId", target._id))
          .unique();
        const current = row?.activity;
        let activity;
        if (command.action === "start") {
          activity = startBotActivity(command, newQuestionId(), now);
        } else {
          if (!current || current.state !== "running" || isStale(current.updatedAt, now)) {
            return { status: 409, error: "no running activity for this target bot" } as const;
          }
          activity = updateBotActivity(current, command, now);
        }
        if (row) await ctx.db.patch(row._id, { activity });
        else await ctx.db.insert("botActivities", { senderId: sender._id, targetId: target._id, activity });
        alertId = activity.alertId;
        content = { activity: { ...activity, action: command.action } };
      }
    } catch (error) {
      if (error instanceof AlertValidationError) return { status: 400, error: error.message } as const;
      throw error;
    }
    await ctx.db.patch(sender._id, { botPageBucket: bucket });
    await ctx.scheduler.runAfter(0, internal.botMessages.deliver, {
      senderId: sender._id,
      targetId: target._id,
      body: JSON.stringify({
        event: "bot_alert",
        alertId,
        sender: { id: sender.id, name: sender.name },
        ...content,
        sentAt: new Date(now).toISOString(),
      }),
      attempt: 1,
    });
    return { alertId };
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
