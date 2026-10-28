import {
  AlertValidationError,
  PENDING_BOT_CAP,
  botPublicId,
  formatPairingCode,
  tooManyPendingBots,
  validatePairingInput,
} from "@puck/shared";
import { internalQueryGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { requireDevice } from "./device";
import { TOO_MANY_PENDING_BOTS } from "./lib/deviceAuth";
import { encryptHeader, hashSecret, mutationRandomInt, newSecret, timingSafeEqual } from "./lib/crypto";

const PAIRING_TTL_MS = 15 * 60 * 1000;
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
export const createPairing = mutationGeneric({
  args: {
    name: v.string(),
    webhookUrl: v.string(),
    webhookHeader: v.string(),
    routine: v.optional(v.string()),
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
    if (tooManyPendingBots(pending.length)) throw new Error(TOO_MANY_PENDING_BOTS);
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

    await ctx.db.insert("bots", {
      id: botId,
      name: pairing.name,
      secretHash,
      webhookUrl: pairing.webhookUrl,
      webhookHeader,
      routine: pairing.routine ?? pairing.name,
      pairingState: "pending",
      pairingCodeHash,
      pairingCodeExpiresAt: now + PAIRING_TTL_MS,
      createdAt: now,
    });

    return { botId, secret, pairingCode };
  },
});

/** The app sends the six-digit code. The claimed device must call it. */
export const approvePairing = mutationGeneric({
  args: { pairingCode: v.string() },
  returns: v.object({ botId: v.string() }),
  handler: async (ctx, args) => {
    await requireDevice(ctx);
    if (!/^\d{6}$/u.test(args.pairingCode)) invalidCode();
    const pairingCodeHash = await hashSecret(args.pairingCode);
    const bot = await ctx.db
      .query("bots")
      .withIndex("by_pairingCodeHash", (q) => q.eq("pairingCodeHash", pairingCodeHash))
      .unique();
    if (!bot || bot.pairingState !== "pending") invalidCode();
    if (bot.pairingCodeExpiresAt === undefined || bot.pairingCodeExpiresAt < Date.now()) invalidCode();
    await ctx.db.patch(bot._id, { pairingState: "paired" });
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
    if (!bot || !matches) return { ok: false as const, reason: "unauthorized" as const };
    if (bot.pairingState !== "paired") return { ok: false as const, reason: "not_paired" as const };
    return { ok: true as const, botDocId: bot._id };
  },
});
