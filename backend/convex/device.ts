import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  DeviceAuthError,
  assertAuthorizedDevice,
  assertCanClaim,
  assertSetupCodeHash,
  deviceJwtIssuer,
} from "./lib/deviceAuth";

type DeviceReadCtx = MutationCtx | QueryCtx;

function rethrow(error: unknown): never {
  if (error instanceof DeviceAuthError) throw new Error(error.message);
  throw error;
}

async function deviceRow(ctx: DeviceReadCtx) {
  return ctx.db.query("device").first();
}

function identityView(identity: { subject: string; issuer: string; token_id?: unknown } | null) {
  if (!identity) return null;
  const tokenId = identity.token_id;
  return {
    subject: identity.subject,
    issuer: identity.issuer,
    tokenId: typeof tokenId === "string" ? tokenId : null,
  };
}

/**
 * The phone must present the device JWT via `setAuth`.
 * Convex checks the signature against the JWKS on `.convex.site`.
 */
export async function requireDevice(ctx: DeviceReadCtx): Promise<{ id: string }> {
  const device = await deviceRow(ctx);
  try {
    const identity = await ctx.auth.getUserIdentity();
    assertAuthorizedDevice(identityView(identity), device, deviceJwtIssuer());
  } catch (error) {
    rethrow(error);
  }
  if (!device) throw new Error("unauthorized");
  return { id: device.id };
}

/**
 * Who the current JWT is. Null when the caller has no valid device token.
 * This is the query a client uses to prove `setAuth` worked.
 */
export const session = queryGeneric({
  args: {},
  returns: v.union(v.null(), v.object({ deviceId: v.string() })),
  handler: async (ctx) => {
    try {
      const device = await requireDevice(ctx);
      return { deviceId: device.id };
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") return null;
      throw error;
    }
  },
});

/**
 * Stores the claimed device. Arguments are hashes and ids only.
 * `POST /device/claim` generates the secret and returns it once.
 */
export const storeClaim = internalMutationGeneric({
  args: {
    setupCodeHash: v.string(),
    secretHash: v.string(),
    deviceId: v.string(),
    tokenId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await assertSetupCodeHash(args.setupCodeHash);
      assertCanClaim((await deviceRow(ctx)) !== null);
    } catch (error) {
      rethrow(error);
    }
    await ctx.db.insert("device", {
      id: args.deviceId,
      secretHash: args.secretHash,
      tokenId: args.tokenId,
      claimedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Checks a hash of the device secret and rotates the JWT id.
 * The signed token is produced in the HTTP action, not returned from here.
 */
export const beginToken = internalMutationGeneric({
  args: { secretHash: v.string(), tokenId: v.string() },
  returns: v.union(v.null(), v.object({ deviceId: v.string(), tokenId: v.string() })),
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("device")
      .withIndex("by_secretHash", (q) => q.eq("secretHash", args.secretHash))
      .unique();
    if (!device) return null;
    await ctx.db.patch(device._id, { tokenId: args.tokenId });
    return { deviceId: device.id, tokenId: args.tokenId };
  },
});

/**
 * Deletes the device row and bots whose names start with a smoke prefix.
 * Dev cleanup only. Refuses any other prefix so it cannot wipe real bots.
 * It also deletes the device, so do not run it after the phone has claimed.
 */
export const clearSmoke = internalMutationGeneric({
  args: { namePrefix: v.string() },
  returns: v.object({
    deletedDevice: v.number(),
    deletedBots: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!args.namePrefix.startsWith("smokedev")) {
      throw new Error("refusing to clear a non-smoke prefix");
    }
    let deletedDevice = 0;
    const devices = await ctx.db.query("device").take(8);
    for (const row of devices) {
      await ctx.db.delete(row._id);
      deletedDevice += 1;
    }
    let deletedBots = 0;
    const bots = await ctx.db.query("bots").take(64);
    for (const bot of bots) {
      if (!bot.name.startsWith(args.namePrefix)) continue;
      const alerts = await ctx.db
        .query("alerts")
        .withIndex("by_bot", (q) => q.eq("botId", bot._id))
        .take(32);
      for (const alert of alerts) {
        const answers = await ctx.db
          .query("answers")
          .withIndex("by_alert", (q) => q.eq("alertId", alert._id))
          .take(8);
        for (const answer of answers) await ctx.db.delete(answer._id);
        await ctx.db.delete(alert._id);
      }
      await ctx.db.delete(bot._id);
      deletedBots += 1;
    }
    return { deletedDevice, deletedBots };
  },
});
