import {
  AlertValidationError,
  PENDING_BOT_CAP,
  botPublicId,
  formatPairingCode,
  tooManyPendingBots,
  validatePairingInput,
} from "@puck/shared";
import { internalMutationGeneric, internalQueryGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { clerkIssuer, requireClient } from "./lib/clientAuth";
import { clerkSubject } from "./lib/clientRules";
import { requireDevice } from "./device";
import { internal } from "./_generated/api";
import { BUILT_IN_BOT_ID, BUILT_IN_BOT_NAME, botMayAuthenticate } from "./lib/builtInBot";
import { TOO_MANY_PENDING_BOTS } from "./lib/deviceAuth";
import { decryptHeader, encryptHeader, hashSecret, mutationRandomInt, newSecret, timingSafeEqual } from "./lib/crypto";
import { countsTowardPendingCap, isOpenRequestFor, pairingStatusOf } from "./lib/pairingRules";
import { selectPushTargets } from "./lib/pushTargets";

const PAIRING_TTL_MS = 15 * 60 * 1000;
const MAX_OWNER_CLIENTS = 50;
const DUMMY_HASH = "0".repeat(64);

function invalidCode(): never {
  throw new Error("pairing code is not valid");
}

function validationMessage(error: unknown): never {
  if (error instanceof AlertValidationError) throw new Error(error.message);
  throw error;
}

/**
 * `puck add`. Returns the secret once; only secretHash is stored.
 * The CLI calls this with no device login. It only creates a pending bot,
 * and pending bots stop at PENDING_BOT_CAP. The device approves before the bot can send.
 */
/** The Clerk user id when the caller is signed in, else null (the typed-code flow). */
async function signedInUserId(ctx: MutationCtx): Promise<string | null> {
  try {
    return clerkSubject(await ctx.auth.getUserIdentity(), clerkIssuer());
  } catch {
    return null;
  }
}

export const createPairing = mutationGeneric({
  args: {
    name: v.string(),
    webhookUrl: v.string(),
    webhookHeader: v.string(),
    routine: v.optional(v.string()),
    colour: v.optional(v.string()),
    addedFrom: v.optional(v.string()),
  },
  returns: v.object({
    botId: v.string(),
    secret: v.string(),
    pairingCode: v.string(),
  }),
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("bots")
      .withIndex("by_pairingState", (q) => q.eq("pairingState", "pending"))
      .take(PENDING_BOT_CAP);
    if (tooManyPendingBots(pending.filter(countsTowardPendingCap).length)) throw new Error(TOO_MANY_PENDING_BOTS);
    let pairing;
    try {
      pairing = validatePairingInput(args);
    } catch (error) {
      validationMessage(error);
    }
    const webhookHeader = await encryptHeader(pairing.webhookHeader);
    const secret = newSecret();
    const secretHash = await hashSecret(secret);
    const now = Date.now();

    let botId = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = botPublicId(pairing.name, mutationRandomInt(100_000));
      const existing = await ctx.db
        .query("bots")
        .withIndex("by_publicId", (q) => q.eq("id", candidate))
        .unique();
      if (!existing) {
        botId = candidate;
        break;
      }
    }
    if (!botId) throw new Error("could not allocate a bot id");

    let pairingCode = "";
    let pairingCodeHash = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = formatPairingCode(mutationRandomInt(1_000_000));
      const hash = await hashSecret(candidate);
      const existing = await ctx.db
        .query("bots")
        .withIndex("by_pairingCodeHash", (q) => q.eq("pairingCodeHash", hash))
        .unique();
      if (!existing) {
        pairingCode = candidate;
        pairingCodeHash = hash;
        break;
      }
    }
    if (!pairingCode) throw new Error("could not allocate a pairing code");

    // Signed in: the request belongs to this user, and their phone gets the pairing push. The code
    // is kept encrypted so their phone can show it for comparing with the terminal.
    const userId = await signedInUserId(ctx);
    const botDocId = await ctx.db.insert("bots", {
      id: botId,
      name: pairing.name,
      secretHash,
      webhookUrl: pairing.webhookUrl,
      webhookHeader,
      routine: pairing.routine ?? pairing.name,
      pairingState: "pending",
      pairingCodeHash,
      pairingCodeExpiresAt: now + PAIRING_TTL_MS,
      ...(pairing.colour === undefined ? {} : { colour: pairing.colour }),
      ...(pairing.addedFrom === undefined ? {} : { addedFrom: pairing.addedFrom }),
      ...(userId === null
        ? {}
        : { userId, pairingCodeCipher: await encryptHeader(pairingCode) }),
      createdAt: now,
    });
    if (userId !== null) await ctx.scheduler.runAfter(0, internal.push.sendPairing, { botDocId });

    return { botId, secret, pairingCode };
  },
});

/**
 * The app sends the six-digit code. With `clientId` the caller is that signed-in client (Clerk
 * identity); without it the claimed device must call it (the legacy path).
 */
export const approvePairing = mutationGeneric({
  args: { pairingCode: v.string(), clientId: v.optional(v.string()) },
  returns: v.object({ botId: v.string() }),
  handler: async (ctx, args) => {
    const client = args.clientId === undefined ? null : await requireClient(ctx, args.clientId);
    if (client === null) await requireDevice(ctx);
    if (!/^\d{6}$/u.test(args.pairingCode)) invalidCode();
    const pairingCodeHash = await hashSecret(args.pairingCode);
    const bot = await ctx.db
      .query("bots")
      .withIndex("by_pairingCodeHash", (q) => q.eq("pairingCodeHash", pairingCodeHash))
      .unique();
    if (!bot || bot.pairingState !== "pending") invalidCode();
    // A request tied to a signed-in owner can only be approved by that owner's clients.
    if (client !== null && bot.userId !== undefined && bot.userId !== client.userId) invalidCode();
    if (bot.pairingCodeExpiresAt === undefined || bot.pairingCodeExpiresAt < Date.now()) invalidCode();
    await ctx.db.patch(bot._id, { pairingState: "paired", pairingCodeCipher: undefined });
    return { botId: bot.id };
  },
});

/** Called from HTTP actions. Compares a hash of the secret; the secret is not an argument. */
export const authenticate = internalQueryGeneric({
  args: { botId: v.string(), secretHash: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(false),
      reason: v.union(v.literal("unauthorized"), v.literal("not_paired")),
    }),
    v.object({ ok: v.literal(true), botDocId: v.id("bots") }),
  ),
  handler: async (ctx, args) => {
    const bot = await ctx.db
      .query("bots")
      .withIndex("by_publicId", (q) => q.eq("id", args.botId))
      .unique();
    const matches = timingSafeEqual(args.secretHash, bot?.secretHash ?? DUMMY_HASH);
    if (!bot || !matches || !botMayAuthenticate(bot)) return { ok: false as const, reason: "unauthorized" as const };
    if (bot.pairingState !== "paired") return { ok: false as const, reason: "not_paired" as const };
    return { ok: true as const, botDocId: bot._id };
  },
});

/**
 * The built-in Puck bot's row, created on first use. It is paired, has no webhook, and its secret
 * hash is the hash of a random secret that is thrown away, so nothing can match it (and
 * `authenticate` refuses built-in bots anyway). Mutations are serialized, so this is race-safe.
 */
export async function getOrCreateBuiltInBot(ctx: MutationCtx): Promise<Id<"bots">> {
  const existing = await ctx.db
    .query("bots")
    .withIndex("by_publicId", (q) => q.eq("id", BUILT_IN_BOT_ID))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("bots", {
    id: BUILT_IN_BOT_ID,
    name: BUILT_IN_BOT_NAME,
    secretHash: await hashSecret(newSecret()),
    webhookUrl: "",
    webhookHeader: "",
    routine: BUILT_IN_BOT_NAME,
    pairingState: "paired",
    builtIn: true,
    createdAt: Date.now(),
  });
}

/** Gets or creates the built-in Puck bot. Idempotent. */
export const ensureBuiltIn = internalMutationGeneric({
  args: {},
  returns: v.id("bots"),
  handler: async (ctx) => getOrCreateBuiltInBot(ctx),
});

/**
 * The owner rejects a pairing request from their phone. The bot row stays, marked `rejectedAt`
 * with its code cleared, so the CLI learns of it through `pairingStatus` and the code cannot be
 * approved afterwards. Only the signed-in owner can reject.
 */
export const rejectPairing = mutationGeneric({
  args: { clientId: v.string(), botId: v.string() },
  returns: v.object({ botId: v.string(), status: v.literal("rejected") }),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const bot = await ctx.db
      .query("bots")
      .withIndex("by_publicId", (q) => q.eq("id", args.botId))
      .unique();
    if (!bot || bot.userId !== client.userId) throw new Error("pairing request not found");
    if (!isOpenRequestFor(bot, client.userId, Date.now())) throw new Error("pairing request is no longer open");
    await ctx.db.patch(bot._id, {
      rejectedAt: Date.now(),
      pairingCodeHash: undefined,
      pairingCodeCipher: undefined,
      pairingCodeExpiresAt: undefined,
    });
    return { botId: bot.id, status: "rejected" as const };
  },
});

const pairingRequestView = v.object({
  botId: v.string(),
  name: v.string(),
  colour: v.union(v.string(), v.null()),
  addedFrom: v.union(v.string(), v.null()),
  pairingCode: v.string(),
  expiresAt: v.number(),
});

/**
 * The signed-in user's open pairing requests (B3, B4, Home): bot id, name, colour, the machine it
 * came from, and the six-digit code to compare with the terminal. Requests whose code cannot be
 * read back are left out.
 */
export const pairingRequests = queryGeneric({
  args: { clientId: v.string() },
  returns: v.array(pairingRequestView),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const now = Date.now();
    const rows = await ctx.db
      .query("bots")
      .withIndex("by_pairingState", (q) => q.eq("pairingState", "pending"))
      .take(PENDING_BOT_CAP * 10);
    const views = [];
    for (const bot of rows) {
      if (!isOpenRequestFor(bot, client.userId, now) || bot.pairingCodeCipher === undefined) continue;
      let pairingCode: string;
      try {
        pairingCode = await decryptHeader(bot.pairingCodeCipher);
      } catch {
        continue;
      }
      views.push({
        botId: bot.id,
        name: bot.name,
        colour: bot.colour ?? null,
        addedFrom: bot.addedFrom ?? null,
        pairingCode,
        expiresAt: bot.pairingCodeExpiresAt ?? now,
      });
    }
    return views;
  },
});

/**
 * What the CLI polls while it waits for approval. Authenticated by the bot's secret from
 * `createPairing`: a wrong secret or an unknown bot is `not_found`.
 */
export const pairingStatus = queryGeneric({
  args: { botId: v.string(), secret: v.string() },
  returns: v.object({
    status: v.union(
      v.literal("pending"),
      v.literal("paired"),
      v.literal("rejected"),
      v.literal("expired"),
      v.literal("not_found"),
    ),
  }),
  handler: async (ctx, args) => {
    const bot = await ctx.db
      .query("bots")
      .withIndex("by_publicId", (q) => q.eq("id", args.botId))
      .unique();
    if (!bot) return { status: "not_found" as const };
    const matches = timingSafeEqual(await hashSecret(args.secret), bot.secretHash);
    if (!matches) return { status: "not_found" as const };
    return { status: pairingStatusOf(bot, Date.now()) };
  },
});

/** What the pairing push needs. Tokens stay out of logs in the action that calls this. */
export const loadPairingPush = internalQueryGeneric({
  args: { botDocId: v.id("bots") },
  returns: v.union(
    v.object({ send: v.literal(false), reason: v.string() }),
    v.object({
      send: v.literal(true),
      botId: v.string(),
      botName: v.string(),
      colour: v.union(v.string(), v.null()),
      addedFrom: v.union(v.string(), v.null()),
      targets: v.array(v.object({ pushToken: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const bot = await ctx.db.get(args.botDocId);
    if (!bot || bot.userId === undefined || !isOpenRequestFor(bot, bot.userId, Date.now())) {
      return { send: false as const, reason: "not an open request" };
    }
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_userId", (q) => q.eq("userId", bot.userId!))
      .take(MAX_OWNER_CLIENTS);
    const targets = selectPushTargets({
      clients: clients.map((row) => ({
        id: row._id as string,
        pushToken: row.pushToken,
        fullScreenAllowed: row.fullScreenAllowed,
      })),
      device: null,
    });
    if (targets.length === 0) return { send: false as const, reason: "no device token" };
    return {
      send: true as const,
      botId: bot.id,
      botName: bot.name,
      colour: bot.colour ?? null,
      addedFrom: bot.addedFrom ?? null,
      targets: targets.map((target) => ({ pushToken: target.pushToken })),
    };
  },
});
