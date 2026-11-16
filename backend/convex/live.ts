// Live activities (N8, H5). The bot drives them through POST /status (http.ts) with the same
// bot-secret auth as POST /alerts, so the mutations take the bot's document id. Owners read them
// with requireClient. Every change schedules a data push to the owner's clients, and a 30-minute
// stale check: a scheduled job that ends the activity if nothing changed since it was scheduled.

import { LIVE_KIND, LIVE_STALE_MS, type LiveState } from "@puck/shared";
import { internalMutationGeneric, internalQueryGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireClient } from "./lib/clientAuth";
import { applyStep, applySteps, currentNote, effectiveState, liveSendMode, recordStep, startTrack, type Track } from "./lib/liveRules";
import { selectPushTargets } from "./lib/pushTargets";
import { alertLink, liveState } from "./schema";

const MAX_OWNER_CLIENTS = 50;
const MAX_LIST = 50;
const SCAN = 200;

/** The bot's running activities (one, plus any left over). Ended ones stay, for the Archive. Bounded. */
async function runningOf(ctx: MutationCtx, botDocId: Id<"bots">): Promise<Doc<"liveActivities">[]> {
  return await ctx.db
    .query("liveActivities")
    .withIndex("by_bot_state", (q) => q.eq("botId", botDocId).eq("state", "running"))
    .take(10);
}

function running(rows: Doc<"liveActivities">[]): Doc<"liveActivities"> | null {
  return rows[0] ?? null;
}

/** After any change: push to the owner's phones, and arm the stale check for this update. */
async function announce(ctx: MutationCtx, activityId: Id<"liveActivities">, updatedAt: number): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.push.sendLive, { activityId });
  await ctx.scheduler.runAfter(LIVE_STALE_MS, internal.live.checkStale, { activityId, updatedAt });
}

function trackFields(track: Track) {
  return {
    ...(track.steps === null ? {} : { steps: track.steps }),
    ...(track.stepIndex === null ? {} : { stepIndex: track.stepIndex }),
    currentStep: track.currentStep,
    log: track.log,
  };
}

function trackOf(row: Doc<"liveActivities">): Track {
  return {
    steps: row.steps ?? null,
    stepIndex: row.stepIndex ?? null,
    currentStep: row.currentStep,
    log: row.log,
  };
}

/**
 * `start`: a new activity. One this bot still has running ends as stale (left unfinished) and,
 * like every ended activity, stays for the Archive.
 */
export const start = internalMutationGeneric({
  args: {
    botDocId: v.id("bots"),
    title: v.string(),
    steps: v.union(v.array(v.string()), v.null()),
    link: v.union(v.string(), v.null()),
    note: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({ activityId: v.string() }),
  handler: async (ctx, args) => {
    const bot = await ctx.db.get(args.botDocId);
    if (!bot) throw new Error("bot not found");
    const now = Date.now();
    for (const row of await runningOf(ctx, args.botDocId)) await ctx.db.patch(row._id, { state: "stale", endedAt: now });
    const track = startTrack(args.steps);
    const activityId = await ctx.db.insert("liveActivities", {
      botId: args.botDocId,
      ...(bot.userId === undefined ? {} : { userId: bot.userId }),
      title: args.title,
      ...trackFields(track),
      history: recordStep([], track.currentStep, now, args.note ?? null),
      ...(args.note ? { note: args.note } : {}),
      state: "running",
      ...(args.link === null ? {} : { link: { label: "Open", url: args.link } }),
      startedAt: now,
      updatedAt: now,
    });
    await announce(ctx, activityId, now);
    return { activityId: activityId as string };
  },
});

/** `step`: move to a step (adding it midway if new). Needs a running activity. */
export const step = internalMutationGeneric({
  args: { botDocId: v.id("bots"), step: v.string(), note: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = running(await runningOf(ctx, args.botDocId));
    if (!row) throw new Error("no running activity");
    const track = applyStep(trackOf(row), args.step);
    const now = Date.now();
    const note = args.note ?? null;
    await ctx.db.patch(row._id, {
      ...trackFields(track),
      history: recordStep(row.history ?? [], track.currentStep, now, note),
      note: currentNote(row.note, note, track.currentStep !== row.currentStep),
      updatedAt: now,
    });
    await announce(ctx, row._id, now);
    return null;
  },
});

/** `steps`: replace the list. Needs a running activity. */
export const steps = internalMutationGeneric({
  args: { botDocId: v.id("bots"), steps: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = running(await runningOf(ctx, args.botDocId));
    if (!row) throw new Error("no running activity");
    const track = applySteps(trackOf(row), args.steps);
    const now = Date.now();
    await ctx.db.patch(row._id, { ...trackFields(track), history: recordStep(row.history ?? [], track.currentStep, now), updatedAt: now });
    await announce(ctx, row._id, now);
    return null;
  },
});

/** `note`: what is happening now, on the current step (or the task, with no steps). Needs a running activity. */
export const note = internalMutationGeneric({
  args: { botDocId: v.id("bots"), note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = running(await runningOf(ctx, args.botDocId));
    if (!row) throw new Error("no running activity");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      note: args.note,
      history: recordStep(row.history ?? [], row.currentStep, now, args.note),
      updatedAt: now,
    });
    await announce(ctx, row._id, now);
    return null;
  },
});

/** `end`: done or failed. The row stays: the card shows it until the bot starts again, the Archive after. */
export const end = internalMutationGeneric({
  args: {
    botDocId: v.id("bots"),
    state: v.union(v.literal("done"), v.literal("failed")),
    note: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = running(await runningOf(ctx, args.botDocId));
    if (!row) throw new Error("no running activity");
    const now = Date.now();
    const note = args.note ?? null;
    await ctx.db.patch(row._id, {
      state: args.state,
      endedAt: now,
      updatedAt: now,
      ...(note === null ? {} : { note, history: recordStep(row.history ?? [], row.currentStep, now, note) }),
    });
    await announce(ctx, row._id, now);
    return null;
  },
});

/**
 * The stale check, scheduled by every change with that change's `updatedAt`. It does nothing
 * unless the activity is still running and nothing has changed since, so a later update leaves
 * the old job harmless.
 */
export const checkStale = internalMutationGeneric({
  args: { activityId: v.id("liveActivities"), updatedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.activityId);
    if (!row || row.state !== "running" || row.updatedAt !== args.updatedAt) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, { state: "stale", endedAt: now });
    await ctx.scheduler.runAfter(0, internal.push.sendLive, { activityId: row._id });
    return null;
  },
});

const pushPayload = v.object({
  send: v.literal(true),
  targets: v.array(v.object({ pushToken: v.string() })),
  activityId: v.string(),
  botId: v.string(),
  botName: v.string(),
  colour: v.union(v.string(), v.null()),
  title: v.string(),
  currentStep: v.string(),
  note: v.union(v.string(), v.null()),
  state: liveState,
  stepIndex: v.union(v.number(), v.null()),
  stepCount: v.union(v.number(), v.null()),
  startedAt: v.number(),
  updatedAt: v.number(),
});

/**
 * What a live-activity push needs. Nothing is sent for a muted bot (its activity still shows on
 * the owner's home), for a bot with no owner, or when the activity has been replaced.
 */
export const loadPush = internalQueryGeneric({
  args: { activityId: v.id("liveActivities") },
  returns: v.union(v.object({ send: v.literal(false), reason: v.string() }), pushPayload),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.activityId);
    if (!row) return { send: false as const, reason: "activity replaced" };
    const bot = await ctx.db.get(row.botId);
    if (!bot) return { send: false as const, reason: "no owner" };
    const mode = liveSendMode(bot, row.userId !== undefined, Date.now());
    if (mode !== "push") return { send: false as const, reason: mode };
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_userId", (q) => q.eq("userId", row.userId!))
      .take(MAX_OWNER_CLIENTS);
    const targets = selectPushTargets({
      clients: clients.map((client) => ({
        id: client._id as string,
        pushToken: client.pushToken,
        fullScreenAllowed: client.fullScreenAllowed,
      })),
      device: null,
    });
    if (targets.length === 0) return { send: false as const, reason: "no device token" };
    return {
      send: true as const,
      targets: targets.map((target) => ({ pushToken: target.pushToken })),
      activityId: row._id as string,
      botId: bot.id,
      botName: bot.name,
      colour: bot.colour ?? null,
      title: row.title,
      currentStep: row.currentStep,
      note: row.note ?? null,
      state: row.state,
      stepIndex: row.stepIndex ?? null,
      stepCount: row.steps?.length ?? null,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
    };
  },
});

const liveView = v.object({
  activityId: v.string(),
  botId: v.string(),
  botName: v.string(),
  colour: v.union(v.string(), v.null()),
  title: v.string(),
  steps: v.union(v.array(v.string()), v.null()),
  stepIndex: v.union(v.number(), v.null()),
  currentStep: v.string(),
  note: v.union(v.string(), v.null()),
  log: v.array(v.string()),
  state: liveState,
  link: v.union(alertLink, v.null()),
  startedAt: v.number(),
  updatedAt: v.number(),
});

async function viewOf(ctx: QueryCtx | MutationCtx, row: Doc<"liveActivities">, now: number) {
  const bot = await ctx.db.get(row.botId);
  return {
    activityId: row._id as string,
    botId: bot?.id ?? "",
    botName: bot?.name ?? "the bot",
    colour: bot?.colour ?? null,
    title: row.title,
    steps: row.steps ?? null,
    stepIndex: row.stepIndex ?? null,
    currentStep: row.currentStep,
    note: row.note ?? null,
    log: row.log,
    state: effectiveState(row, now) as LiveState,
    link: row.link ?? null,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
  };
}

/** The signed-in user's running activities (H5), oldest first. Stale ones are left out. */
export const forUser = queryGeneric({
  args: { clientId: v.string() },
  returns: v.array(liveView),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const now = Date.now();
    const rows = await ctx.db
      .query("liveActivities")
      .withIndex("by_state", (q) => q.eq("state", "running"))
      .take(SCAN);
    const mine = rows
      .filter((row) => row.userId === client.userId && effectiveState(row, now) === "running")
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, MAX_LIST);
    const views = [];
    for (const row of mine) views.push(await viewOf(ctx, row, now));
    return views;
  },
});

/** The bot's current activity (running or ended), for the owner. Null when it has none. */
export const forBot = queryGeneric({
  args: { clientId: v.string(), botId: v.string() },
  returns: v.union(v.null(), liveView),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const bot = await ctx.db
      .query("bots")
      .withIndex("by_publicId", (q) => q.eq("id", args.botId))
      .unique();
    if (!bot || bot.userId !== client.userId) return null;
    // Newest first: the running one if any (it is the newest), else the last to end.
    const rows = await ctx.db
      .query("liveActivities")
      .withIndex("by_bot", (q) => q.eq("botId", bot._id))
      .order("desc")
      .take(10);
    const row = rows.find((candidate) => candidate.state === "running") ?? rows[0];
    if (!row) return null;
    return await viewOf(ctx, row, Date.now());
  },
});

const archivedView = v.object({
  activityId: v.string(),
  botId: v.string(),
  botName: v.string(),
  colour: v.union(v.string(), v.null()),
  title: v.string(),
  steps: v.union(v.array(v.string()), v.null()),
  state: liveState,
  startedAt: v.number(),
  endedAt: v.number(),
  /** The note it ended with (or the last one given). */
  note: v.union(v.string(), v.null()),
  history: v.array(v.object({ step: v.string(), at: v.number(), note: v.optional(v.string()) })),
});

const ARCHIVE_MAX = 100;

/**
 * The Archive's finished tasks (done, failed, or left unfinished), newest first: each with the
 * steps it went through and when. A task with no record of its steps (from before steps were
 * recorded) shows the one it ended on.
 */
export const archive = queryGeneric({
  args: { clientId: v.string() },
  returns: v.array(archivedView),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const now = Date.now();
    const rows = await ctx.db
      .query("liveActivities")
      .withIndex("by_user", (q) => q.eq("userId", client.userId))
      .order("desc")
      .take(SCAN);
    const ended = rows.filter((row) => effectiveState(row, now) !== "running").slice(0, ARCHIVE_MAX);
    const botNames = new Map<string, Doc<"bots"> | null>();
    const views = [];
    for (const row of ended) {
      const key = row.botId as string;
      if (!botNames.has(key)) botNames.set(key, await ctx.db.get(row.botId));
      const bot = botNames.get(key) ?? null;
      const history = row.history ?? (row.currentStep === "" ? [] : [{ step: row.currentStep, at: row.updatedAt }]);
      views.push({
        activityId: row._id as string,
        botId: bot?.id ?? "",
        botName: bot?.name ?? "the bot",
        colour: bot?.colour ?? null,
        title: row.title,
        steps: row.steps ?? null,
        state: effectiveState(row, now) as LiveState,
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? row.updatedAt,
        note: row.note ?? null,
        history,
      });
    }
    return views.sort((a, b) => b.endedAt - a.endedAt);
  },
});
