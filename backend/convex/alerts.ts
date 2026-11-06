import {
  cancelStep,
  isQuestionId,
  isoUtc,
  releaseStep,
  snoozeReleaseStep,
  type AlertExtras,
} from "@puck/shared";
import {
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
} from "convex/server";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { answerReceipt, buildTimeline, historyOutcome, isWaiting } from "./lib/alertHistory";
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
  attachmentType,
  deliveryStatus,
  option,
  optionTone,
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
      // An alert past its expiry can no longer be answered (Q8); the app shows A9 for one on screen.
      if (alert.expiresAt !== undefined && alert.expiresAt <= Date.now()) continue;
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

/* ------------------------------------------------------------ Needs you, Earlier, H4 */

const receiptLiteral = v.union(v.literal("pending"), v.literal("sent"), v.literal("delivered"), v.literal("failed"));
const timelineKind = v.union(
  v.literal("created"),
  v.literal("snoozed"),
  v.literal("answered"),
  v.literal("delivered"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("missed"),
);

// Every field `alerts.pending` returns (so the alert screens open either list the same way),
// plus the waiting-only fields.
const waitingAlert = v.object({
  ...pendingAlert.fields,
  status: v.union(v.literal("pending"), v.literal("snoozed")),
  snoozedUntil: v.union(v.number(), v.null()),
  expiresAt: v.union(v.number(), v.null()),
});

const MAX_WAITING = 50;

/**
 * Everything waiting on this client (Needs you, H1): pending alerts oldest first, then snoozed
 * ones oldest first. Only alerts sent to this client (or to every client) and not past expiry.
 * Snoozed alerts show whoever snoozed them, since the snooze is shared. At most 50.
 */
export const waiting = queryGeneric({
  args: { clientId: v.string() },
  returns: v.array(waitingAlert),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const now = Date.now();
    const views: Array<{ status: "pending" | "snoozed"; view: WaitingView }> = [];
    for (const status of ["pending", "snoozed"] as const) {
      const rows = await ctx.db
        .query("alerts")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(100);
      const found: WaitingView[] = [];
      for (const alert of rows) {
        if (!alertIsForClient(alert.targetClientId, client._id)) continue;
        if (!isWaiting(alert.status, alert.expiresAt ?? null, now)) continue;
        const bot = await ctx.db.get(alert.botId);
        if (!bot || bot.pairingState !== "paired") continue;
        found.push({
          questionId: alert.questionId,
          question: alert.question,
          botId: bot.id,
          botName: bot.name,
          priority: alert.priority,
          status,
          presentation: alert.presentation ?? "choice",
          selectionMode: alert.selectionMode,
          options: alert.options,
          ...pickAlertExtras(alert),
          snoozedUntil: alert.snoozedUntil ?? null,
          expiresAt: alert.expiresAt ?? null,
          createdAt: alert.createdAt,
        });
      }
      found.sort((a, b) => a.createdAt - b.createdAt);
      for (const view of found) views.push({ status, view });
    }
    return views.slice(0, MAX_WAITING).map((entry) => entry.view);
  },
});

type WaitingView = Infer<typeof waitingAlert>;

const historyItem = v.object({
  questionId: v.string(),
  question: v.string(),
  botId: v.string(),
  botName: v.string(),
  outcome: v.union(v.literal("answered"), v.literal("cancelled"), v.literal("missed")),
  picks: v.array(v.string()),
  customReply: v.union(v.string(), v.null()),
  hasAttachments: v.boolean(),
  answeredAt: v.union(v.number(), v.null()),
  answeredByClientName: v.union(v.string(), v.null()),
  deliveryStatus: v.union(deliveryStatus, v.null()),
  createdAt: v.number(),
});

/**
 * Earlier (H1, H4 history), newest first, one page at a time. Answered, cancelled and missed
 * alerts only (`historyOutcome`). Convex pages over every alert in creation order and this
 * client's history is picked out of each page, so a page can hold fewer than `numItems` rows.
 * Continue while `isDone` is false, even when a page is empty.
 */
export const history = queryGeneric({
  args: { clientId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(historyItem),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const now = Date.now();
    // Pages are picked out of creation order per client; a per-client index is needed for many users.
    const result = await ctx.db.query("alerts").order("desc").paginate(args.paginationOpts);
    const page = [];
    for (const alert of result.page) {
      if (!alertIsForClient(alert.targetClientId, client._id)) continue;
      const outcome = historyOutcome({ status: alert.status, expiresAt: alert.expiresAt ?? null }, now);
      if (outcome === null) continue;
      const bot = await ctx.db.get(alert.botId);
      const answer = await answerForQuestion(ctx, alert.questionId);
      const answeredBy = alert.answeredByClientId ? await ctx.db.get(alert.answeredByClientId) : null;
      page.push({
        questionId: alert.questionId,
        question: alert.question,
        botId: bot?.id ?? "",
        botName: bot?.name ?? "the bot",
        outcome,
        picks: answer ? answer.answers.map((choice) => choice.label) : [],
        customReply: answer?.customReply ?? null,
        hasAttachments: (answer?.attachments?.length ?? 0) > 0,
        answeredAt: answer?.answeredAt ?? null,
        answeredByClientName: answeredBy?.name ?? null,
        deliveryStatus: answer?.deliveryStatus ?? null,
        createdAt: alert.createdAt,
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

async function answerForQuestion(ctx: QueryCtx, questionId: string) {
  return await ctx.db
    .query("answers")
    .withIndex("by_questionId", (q) => q.eq("questionId", questionId))
    .unique();
}

const optionView = v.object({
  id: v.string(),
  label: v.string(),
  icon: v.union(v.string(), v.null()),
  desc: v.union(v.string(), v.null()),
  tone: v.union(optionTone, v.null()),
  rec: v.boolean(),
  chosen: v.boolean(),
});

/** Plain shapes only: no storage ids and no URLs for attachments. */
const answerDetail = v.object({
  answerId: v.string(),
  picks: v.array(v.string()),
  customReply: v.union(v.string(), v.null()),
  attachments: v.array(v.object({ name: v.string(), type: attachmentType, size: v.number() })),
  answeredAt: v.number(),
  answeredByClientName: v.union(v.string(), v.null()),
});

const deliveryDetail = v.object({
  state: receiptLiteral,
  attempts: v.number(),
  lastError: v.union(v.string(), v.null()),
});

const LAST_ERROR_MAX = 200;

/**
 * One alert for H4: the alert itself, the answer and its delivery, the snoozes and a timeline.
 * Null when it does not exist or was not sent to this client. `delivery` is null until answered.
 */
export const get = queryGeneric({
  args: { clientId: v.string(), questionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      questionId: v.string(),
      question: v.string(),
      message: v.union(v.string(), v.null()),
      details: v.union(v.string(), v.null()),
      link: v.union(v.object({ label: v.string(), url: v.string() }), v.null()),
      priority,
      presentation,
      selectionMode,
      status: alertStatus,
      options: v.array(optionView),
      expiresAt: v.union(v.number(), v.null()),
      createdAt: v.number(),
      botId: v.string(),
      botName: v.string(),
      answer: v.union(answerDetail, v.null()),
      delivery: v.union(deliveryDetail, v.null()),
      snoozes: v.array(v.object({ at: v.number(), until: v.union(v.number(), v.null()) })),
      timeline: v.array(v.object({ kind: timelineKind, at: v.number(), text: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const alert = await ctx.db
      .query("alerts")
      .withIndex("by_questionId", (q) => q.eq("questionId", args.questionId))
      .unique();
    if (!alert || !alertIsForClient(alert.targetClientId, client._id)) return null;
    const bot = await ctx.db.get(alert.botId);
    if (!bot) return null;
    const now = Date.now();
    const answer = await answerForQuestion(ctx, alert.questionId);
    const answeredBy = alert.answeredByClientId ? await ctx.db.get(alert.answeredByClientId) : null;
    const snoozeRows = await ctx.db
      .query("snoozeEvents")
      .withIndex("by_alert", (q) => q.eq("alertId", alert._id))
      .collect();
    const snoozes = snoozeRows
      .map((row) => ({ at: row.snoozedAt, until: row.snoozedUntil }))
      .sort((a, b) => a.at - b.at);
    const picked = new Set((answer?.answers ?? []).map((choice) => choice.id));
    const answeredByClientName = answeredBy?.name ?? null;
    const lastError = answer?.lastError ? answer.lastError.slice(0, LAST_ERROR_MAX) : null;
    return {
      questionId: alert.questionId,
      question: alert.question,
      message: alert.message ?? null,
      details: alert.details ?? null,
      link: alert.link ?? null,
      priority: alert.priority,
      presentation: alert.presentation ?? "choice",
      selectionMode: alert.selectionMode,
      status: alert.status,
      options: alert.options.map((entry: StoredOptionInput) => ({
        id: entry.id,
        label: entry.label,
        icon: entry.icon ?? null,
        desc: entry.desc ?? null,
        tone: entry.tone ?? null,
        rec: entry.rec === true,
        chosen: picked.has(entry.id),
      })),
      expiresAt: alert.expiresAt ?? null,
      createdAt: alert.createdAt,
      botId: bot.id,
      botName: bot.name,
      answer: answer
        ? {
            answerId: answer._id as string,
            picks: answer.answers.map((choice) => choice.label),
            customReply: answer.customReply,
            attachments: (answer.attachments ?? []).map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
            })),
            answeredAt: answer.answeredAt,
            answeredByClientName,
          }
        : null,
      delivery: answer
        ? {
            state: answerReceipt(answer),
            attempts: answer.deliveryAttempts,
            lastError,
          }
        : null,
      snoozes,
      timeline: buildTimeline(
        {
          botName: bot.name,
          createdAt: alert.createdAt,
          status: alert.status,
          expiresAt: alert.expiresAt ?? null,
          updatedAt: alert.updatedAt,
          answer: answer
            ? {
                answeredAt: answer.answeredAt,
                answeredByClientName,
                deliveredAt: answer.deliveredAt ?? null,
                deliveryStatus: answer.deliveryStatus,
                deliveryAttempts: answer.deliveryAttempts,
                lastError,
              }
            : null,
          snoozes: snoozes.map((snooze) => ({ snoozedAt: snooze.at, snoozedUntil: snooze.until })),
        },
        now,
      ),
    };
  },
});
