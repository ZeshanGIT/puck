import { isQuestionId, isoUtc, type AlertOption } from "@puck/shared";
import { internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";
import { newQuestionId } from "./lib/crypto";
import { alertStatus, answerChoice, deliveryStatus, option, priority, selectionMode } from "./schema";

function storedOptions(options: AlertOption[]) {
  return options.map((entry) =>
    entry.icon === undefined ? { id: entry.id, label: entry.label } : entry,
  );
}

export const create = internalMutationGeneric({
  args: {
    botDocId: v.id("bots"),
    question: v.string(),
    priority,
    selectionMode,
    options: v.array(option),
    scheduledFor: v.union(v.number(), v.null()),
  },
  returns: v.object({ questionId: v.string() }),
  handler: async (ctx, args) => {
    const bot = await ctx.db.get(args.botDocId);
    if (!bot || bot.pairingState !== "paired") throw new Error("bot is not paired");

    let questionId = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = newQuestionId();
      if (!isQuestionId(candidate)) continue;
      const existing = await ctx.db
        .query("alerts")
        .withIndex("by_questionId", (q) => q.eq("questionId", candidate))
        .unique();
      if (!existing) {
        questionId = candidate;
        break;
      }
    }
    if (!questionId) throw new Error("could not allocate a question id");

    const now = Date.now();
    const scheduledFor = args.scheduledFor === null ? undefined : args.scheduledFor;
    const status = scheduledFor !== undefined && scheduledFor > now ? "scheduled" : "pending";
    await ctx.db.insert("alerts", {
      questionId,
      botId: args.botDocId,
      question: args.question,
      priority: args.priority,
      selectionMode: args.selectionMode,
      options: storedOptions(args.options),
      status,
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
      createdAt: now,
      updatedAt: now,
    });
    return { questionId };
  },
});

const answerView = v.object({
  answers: v.array(answerChoice),
  customReply: v.union(v.string(), v.null()),
  answeredAt: v.string(),
  source: v.literal("app"),
  deliveryStatus,
  deliveryAttempts: v.number(),
  lastError: v.union(v.string(), v.null()),
});

export const getStatus = internalQueryGeneric({
  args: { botDocId: v.id("bots"), questionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      questionId: v.string(),
      question: v.string(),
      botId: v.string(),
      priority,
      selectionMode,
      options: v.array(option),
      status: alertStatus,
      scheduledFor: v.union(v.number(), v.null()),
      createdAt: v.number(),
      answer: v.union(answerView, v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const alert = await ctx.db
      .query("alerts")
      .withIndex("by_questionId", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (!alert || alert.botId !== args.botDocId) return null;
    const bot = await ctx.db.get(alert.botId);
    if (!bot) return null;
    const answer = await ctx.db
      .query("answers")
      .withIndex("by_questionId", (q) => q.eq("questionId", alert.questionId))
      .unique();
    return {
      questionId: alert.questionId,
      question: alert.question,
      botId: bot.id,
      priority: alert.priority,
      selectionMode: alert.selectionMode,
      options: alert.options,
      status: alert.status,
      scheduledFor: alert.scheduledFor ?? null,
      createdAt: alert.createdAt,
      answer: answer
        ? {
            answers: answer.answers,
            customReply: answer.customReply,
            answeredAt: isoUtc(answer.answeredAt),
            source: answer.source,
            deliveryStatus: answer.deliveryStatus,
            deliveryAttempts: answer.deliveryAttempts,
            lastError: answer.lastError ?? null,
          }
        : null,
    };
  },
});
