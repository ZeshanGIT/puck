import { cancelStep, isQuestionId, isoUtc, releaseStep, snoozeReleaseStep, type AlertExtras } from "@puck/shared";
import { internalMutationGeneric, internalQueryGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getOrCreateBuiltInBot } from "./bots";
import { requireDevice } from "./device";
import { TEST_PAGE_OPTIONS, TEST_PAGE_QUESTION, decideTestPage } from "./lib/builtInBot";
import { requireClient } from "./lib/clientAuth";
import { pickAlertExtras, storedOption, type StoredOptionInput } from "./lib/alertFields";
import { newQuestionId } from "./lib/crypto";
import { selectDismissTargets } from "./lib/fcm";
import { alertIsForClient, selectPushTargets } from "./lib/pushTargets";
import {
  alertExtraFields,
  alertStatus,
  answerChoice,
  deliveryStatus,
  option,
  presentation,
  priority,
  selectionMode,
} from "./schema";

const MAX_PUSH_CLIENTS = 50;

function storedOptions(options: StoredOptionInput[]) {
  return options.map((entry) => storedOption(entry));
}

interface NewAlert extends AlertExtras {
  question: string;
  // Same loose types the schema validators give (`literals()` widens to string).
  priority: string;
  selectionMode: string;
  presentation: string;
  options: StoredOptionInput[];
  scheduledFor: number | null;
  targetClientId?: string;
}

/** Allocates a question id, inserts the alert and schedules its push (or its release). */
async function insertAlert(ctx: MutationCtx, botDocId: Id<"bots">, args: NewAlert): Promise<{ questionId: string }> {
  const bot = await ctx.db.get(botDocId);
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
  const alertId = await ctx.db.insert("alerts", {
    questionId,
    botId: botDocId,
    question: args.question,
    priority: args.priority,
    selectionMode: args.selectionMode,
    presentation: args.presentation,
    options: storedOptions(args.options),
    status,
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
    ...(args.targetClientId ? { targetClientId: args.targetClientId } : {}),
    ...pickAlertExtras(args),
    createdAt: now,
    updatedAt: now,
  });
  if (status === "pending") {
    await ctx.scheduler.runAfter(0, internal.push.send, { alertId });
  } else if (scheduledFor !== undefined) {
    await ctx.scheduler.runAt(scheduledFor, internal.alerts.release, { alertId });
  }
  return { questionId };
}

export const create = internalMutationGeneric({
  args: {
    botDocId: v.id("bots"),
    question: v.string(),
    priority,
    selectionMode,
    presentation,
    options: v.array(option),
    scheduledFor: v.union(v.number(), v.null()),
    targetClientId: v.optional(v.string()),
    ...alertExtraFields,
  },
  returns: v.object({ questionId: v.string() }),
  handler: async (ctx, args) => {
    const { botDocId, ...alert } = args;
    return await insertAlert(ctx, botDocId, alert);
  },
});

/**
 * A test page: an urgent alert from the built-in Puck bot to the calling client (onboarding O3,
 * Settings S5). At most one unanswered test page per client: a fresh one is returned as it is,
 * stale ones are cancelled and replaced (see `decideTestPage`).
 */
/**
 * Cancels this client's unanswered test pages (pending or scheduled). The test page screen calls
 * it on open, so a page left from an earlier try never greets the person before they tap Send.
 */
export const cancelTests = mutationGeneric({
  args: { clientId: v.string() },
  returns: v.object({ cancelled: v.number() }),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const botDocId = await getOrCreateBuiltInBot(ctx);
    let cancelled = 0;
    for (const status of ["pending", "scheduled"] as const) {
      const rows = await ctx.db.query("alerts").withIndex("by_status", (q) => q.eq("status", status)).take(100);
      for (const alert of rows) {
        if (alert.botId !== botDocId || alert.targetClientId !== client._id) continue;
        await ctx.db.patch(alert._id, { status: "cancelled", updatedAt: Date.now() });
        cancelled += 1;
      }
    }
    return { cancelled };
  },
});

export const sendTest = mutationGeneric({
  args: { clientId: v.string(), delaySeconds: v.optional(v.number()) },
  returns: v.object({ questionId: v.string() }),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const botDocId = await getOrCreateBuiltInBot(ctx);
    // A delay lets the person lock the phone first: the page is scheduled and released by the
    // same scheduler as `puck schedule`. A delayed page replaces any unanswered one.
    const delayMs = Math.min(60, Math.max(0, Math.floor(args.delaySeconds ?? 0))) * 1000;
    const statuses = delayMs > 0 ? (["pending", "scheduled"] as const) : (["pending"] as const);
    const rows = [];
    for (const status of statuses) {
      rows.push(...(await ctx.db.query("alerts").withIndex("by_status", (q) => q.eq("status", status)).take(100)));
    }
    const mine = rows.filter((alert) => alert.botId === botDocId && alert.targetClientId === client._id);
    if (delayMs > 0) {
      for (const alert of mine) await ctx.db.patch(alert._id, { status: "cancelled", updatedAt: Date.now() });
      return await insertAlert(ctx, botDocId, {
        question: TEST_PAGE_QUESTION,
        priority: "urgent",
        selectionMode: "single",
        presentation: "choice",
        options: [...TEST_PAGE_OPTIONS],
        scheduledFor: Date.now() + delayMs,
        targetClientId: client._id,
      });
    }
    const decision = decideTestPage(
      mine.map((alert) => ({ questionId: alert.questionId, createdAt: alert.createdAt })),
      Date.now(),
    );
    if (decision.action === "reuse") return { questionId: decision.questionId };
    for (const alert of mine) {
      if (decision.cancel.includes(alert.questionId)) {
        await ctx.db.patch(alert._id, { status: "cancelled", updatedAt: Date.now() });
      }
    }
    return await insertAlert(ctx, botDocId, {
      question: TEST_PAGE_QUESTION,
      priority: "urgent",
      selectionMode: "single",
      presentation: "choice",
      options: [...TEST_PAGE_OPTIONS],
      scheduledFor: null,
      targetClientId: client._id,
    });
  },
});

/** Turns a scheduled alert into a pending one and sends the same push as a new alert. */
export const release = internalMutationGeneric({
  args: { alertId: v.id("alerts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert) return null;
    const now = Date.now();
    const step = releaseStep(alert.status, alert.scheduledFor ?? null, now);
    if (step === "skip") return null;
    if (step === "wait" && alert.scheduledFor !== undefined) {
      await ctx.scheduler.runAt(alert.scheduledFor, internal.alerts.release, { alertId: alert._id });
      return null;
    }
    if (step !== "pending") return null;
    await ctx.db.patch(alert._id, { status: "pending", updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.push.send, { alertId: alert._id });
    return null;
  },
});

/**
 * Ends a timed snooze: the alert goes back to pending and gets the same push as a new alert
 * (ringing again if urgent). Only the snooze that scheduled this job counts; if the alert was
 * answered, cancelled, snoozed again or woken meanwhile, nothing happens.
 */
export const releaseSnoozed = internalMutationGeneric({
  args: { alertId: v.id("alerts"), snoozedUntil: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert) return null;
    if (snoozeReleaseStep(alert.status, alert.snoozedUntil ?? null, args.snoozedUntil) !== "pending") return null;
    await ctx.db.patch(alert._id, {
      status: "pending",
      updatedAt: Date.now(),
      snoozedUntil: undefined,
      snoozedByClientId: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.push.send, { alertId: alert._id });
    return null;
  },
});

/**
 * "Until I'm back": the app calls this when it returns to the foreground. This client's untimed
 * snoozed alerts go back to pending. No push, because he is already looking at the app.
 * Timed snoozes keep their own release.
 */
export const wakeSnoozed = mutationGeneric({
  args: { clientId: v.string() },
  returns: v.object({ woken: v.number() }),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const rows = await ctx.db
      .query("alerts")
      .withIndex("by_status", (q) => q.eq("status", "snoozed"))
      .take(100);
    let woken = 0;
    for (const alert of rows) {
      if (alert.snoozedByClientId !== client._id || alert.snoozedUntil !== undefined) continue;
      await ctx.db.patch(alert._id, {
        status: "pending",
        updatedAt: Date.now(),
        snoozedByClientId: undefined,
      });
      woken += 1;
    }
    return { woken };
  },
});

/**
 * What the alert on screen is doing now, so the app can show A9 when it is no longer pending:
 * cancelled, answered on another client (`answeredByClientName`), or past `expiresAt`.
 * Null when the alert does not exist.
 */
export const state = queryGeneric({
  args: { clientId: v.string(), questionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: alertStatus,
      answeredByClientName: v.union(v.string(), v.null()),
      expiresAt: v.union(v.number(), v.null()),
      // What was chosen, for A9's "Answered on MacBook: Ship it". Empty until answered.
      answerLabels: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireClient(ctx, args.clientId);
    const alert = await ctx.db
      .query("alerts")
      .withIndex("by_questionId", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (!alert) return null;
    const answeredBy = alert.answeredByClientId ? await ctx.db.get(alert.answeredByClientId) : null;
    const answer =
      alert.status === "answered"
        ? await ctx.db
            .query("answers")
            .withIndex("by_questionId", (q) => q.eq("questionId", alert.questionId))
            .unique()
        : null;
    return {
      status: alert.status,
      answeredByClientName: answeredBy?.name ?? null,
      expiresAt: alert.expiresAt ?? null,
      answerLabels: answer ? answer.answers.map((choice: { label: string }) => choice.label) : [],
    };
  },
});

/** Push tokens that should drop an alert someone else answered or snoozed. Tokens stay out of logs. */
export const loadDismissTargets = internalQueryGeneric({
  args: { exceptClientId: v.optional(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const clients = await ctx.db.query("clients").take(MAX_PUSH_CLIENTS);
    const device = await ctx.db.query("device").first();
    return selectDismissTargets({
      clients: clients.map((row) => ({
        id: row._id as string,
        pushToken: row.pushToken,
        fullScreenAllowed: row.fullScreenAllowed,
      })),
      device,
      exceptClientId: args.exceptClientId ?? null,
    });
  },
});

/** Cancels a pending, scheduled or snoozed alert owned by this bot. An answer stays stored. */
export const cancel = internalMutationGeneric({
  args: { botDocId: v.id("bots"), questionId: v.string() },
  returns: v.object({ questionId: v.string(), status: v.literal("cancelled") }),
  handler: async (ctx, args) => {
    const alert = await ctx.db
      .query("alerts")
      .withIndex("by_questionId", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (!alert || alert.botId !== args.botDocId) throw new Error("alert not found");
    const step = cancelStep(alert.status);
    if (step === "rejected") throw new Error("alert is already answered");
    if (step === "cancelled") {
      await ctx.db.patch(alert._id, { status: "cancelled", updatedAt: Date.now() });
    }
    return { questionId: alert.questionId, status: "cancelled" as const };
  },
});

const listedAlert = v.object({
  questionId: v.string(),
  question: v.string(),
  status: alertStatus,
  priority,
  scheduledFor: v.union(v.number(), v.null()),
  createdAt: v.number(),
});

/** Pending, scheduled and snoozed alerts for one bot, soonest first. */
export const listForBot = internalQueryGeneric({
  args: { botDocId: v.id("bots") },
  returns: v.array(listedAlert),
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("alerts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(50);
    const scheduled = await ctx.db
      .query("alerts")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .take(50);
    const snoozed = await ctx.db
      .query("alerts")
      .withIndex("by_status", (q) => q.eq("status", "snoozed"))
      .take(50);
    return [...pending, ...scheduled, ...snoozed]
      .filter((alert) => alert.botId === args.botDocId)
      .map((alert) => ({
        questionId: alert.questionId,
        question: alert.question,
        status: alert.status,
        priority: alert.priority,
        scheduledFor: alert.scheduledFor ?? null,
        createdAt: alert.createdAt,
      }))
      .sort((a, b) => (a.scheduledFor ?? a.createdAt) - (b.scheduledFor ?? b.createdAt));
  },
});

const pendingAlert = v.object({
  questionId: v.string(),
  question: v.string(),
  botId: v.string(),
  botName: v.string(),
  priority,
  selectionMode,
  presentation,
  options: v.array(option),
  ...alertExtraFields,
  createdAt: v.number(),
});

/**
 * Pending alerts, oldest first. With `clientId` the caller is that signed-in client and alerts
 * aimed at another client are left out. Without it the caller must be the claimed device.
 */
export const pending = queryGeneric({
  args: { clientId: v.optional(v.string()) },
  returns: v.array(pendingAlert),
  handler: async (ctx, args) => {
    const client = args.clientId === undefined ? null : await requireClient(ctx, args.clientId);
    if (!client) await requireDevice(ctx);
    const rows = await ctx.db
      .query("alerts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(32);
    const views = [];
    for (const alert of rows) {
      if (client && !alertIsForClient(alert.targetClientId, client._id)) continue;
      const bot = await ctx.db.get(alert.botId);
      if (!bot || bot.pairingState !== "paired") continue;
      views.push({
        questionId: alert.questionId,
        question: alert.question,
        botId: bot.id,
        botName: bot.name,
        priority: alert.priority,
        selectionMode: alert.selectionMode,
        presentation: alert.presentation ?? "choice",
        options: alert.options,
        ...pickAlertExtras(alert),
        createdAt: alert.createdAt,
      });
    }
    views.sort((a, b) => a.createdAt - b.createdAt);
    return views;
  },
});

/** What a heads-up needs. The tokens stay out of logs in the action that calls this. */
export const loadForPush = internalQueryGeneric({
  args: { alertId: v.id("alerts") },
  returns: v.union(
    v.object({
      send: v.literal(false),
      reason: v.union(v.literal("not pending"), v.literal("no device token")),
    }),
    v.object({
      send: v.literal(true),
      targets: v.array(v.object({ pushToken: v.string(), fullScreenAllowed: v.boolean() })),
      questionId: v.string(),
      question: v.string(),
      botName: v.string(),
      priority,
      // What the phone needs to ring the way the alert asks (Protocol changes §1).
      message: v.optional(v.string()),
      ringSeconds: v.optional(v.number()),
      speak: v.optional(v.boolean()),
      bypassDnd: v.optional(v.boolean()),
      bypassSilent: v.optional(v.boolean()),
      requiresUnlock: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.status !== "pending") return { send: false as const, reason: "not pending" as const };
    const bot = await ctx.db.get(alert.botId);
    if (!bot || bot.pairingState !== "paired") return { send: false as const, reason: "not pending" as const };
    // The app is single-user for now, so every client is a target. The bot's owner arrives with pairing.
    const clients = await ctx.db.query("clients").take(MAX_PUSH_CLIENTS);
    const device = await ctx.db.query("device").first();
    const targets = selectPushTargets({
      clients: clients.map((row) => ({
        id: row._id as string,
        pushToken: row.pushToken,
        fullScreenAllowed: row.fullScreenAllowed,
      })),
      device,
      targetClientId: alert.targetClientId,
    });
    if (targets.length === 0) return { send: false as const, reason: "no device token" as const };
    return {
      send: true as const,
      targets,
      questionId: alert.questionId,
      question: alert.question,
      botName: bot.name,
      priority: alert.priority,
      ...(alert.message === undefined ? {} : { message: alert.message }),
      ...(alert.ringSeconds === undefined ? {} : { ringSeconds: alert.ringSeconds }),
      ...(alert.speak === undefined ? {} : { speak: alert.speak }),
      ...(alert.bypassDnd === undefined ? {} : { bypassDnd: alert.bypassDnd }),
      ...(alert.bypassSilent === undefined ? {} : { bypassSilent: alert.bypassSilent }),
      ...(alert.requiresUnlock === undefined ? {} : { requiresUnlock: alert.requiresUnlock }),
    };
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
      presentation,
      options: v.array(option),
      status: alertStatus,
      scheduledFor: v.union(v.number(), v.null()),
      ...alertExtraFields,
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
      presentation: alert.presentation ?? "choice",
      options: alert.options,
      status: alert.status,
      scheduledFor: alert.scheduledFor ?? null,
      ...pickAlertExtras(alert),
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
