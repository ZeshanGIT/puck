import { DEVICE_JWT_AUDIENCE, DEVICE_TOKEN_TTL_SECONDS } from "@puck/shared";
import { mutationGeneric, internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutationRandomByte } from "./lib/crypto";
import {
  DeviceAuthError,
  assertAuthorizedDevice,
  assertCanClaim,
  assertSetupCode,
  deviceJwtIssuer,
  loadSigningKey,
  signDeviceJwt,
} from "./lib/deviceAuth";

function newToken(prefix: string): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = mutationRandomByte();
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `${prefix}${encoded}`;
}

function rethrow(error: unknown): never {
  if (error instanceof DeviceAuthError) throw new Error(error.message);
  throw error;
}

async function deviceRow(ctx: MutationCtx) {
  return ctx.db.query("device").first();
}

/**
 * The phone must present the device JWT. The Convex client sends it with
 * `setAuth`. Convex checks the signature against the JWKS on `.convex.site`.
 */
export async function requireDevice(ctx: MutationCtx): Promise<void> {
  const device = await deviceRow(ctx);
  try {
    const identity = await ctx.auth.getUserIdentity();
    const tokenId = identity?.token_id;
    assertAuthorizedDevice(
      identity
        ? {
            subject: identity.subject,
            issuer: identity.issuer,
            tokenId: typeof tokenId === "string" ? tokenId : null,
          }
        : null,
      device,
      deviceJwtIssuer(),
    );
  } catch (error) {
    rethrow(error);
  }
}

/**
 * First phone wins. The setup code is the only argument; the token is returned once.
 * A second call fails even with the right code.
 */
export const claim = mutationGeneric({
  args: { setupCode: v.string() },
  returns: v.object({
    deviceId: v.string(),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    try {
      await assertSetupCode(args.setupCode);
      assertCanClaim((await deviceRow(ctx)) !== null);
      const privateKey = await loadSigningKey();
      const issuer = deviceJwtIssuer();
      const deviceId = newToken("dev_");
      const tokenId = newToken("tid_");
      const nowSeconds = Math.floor(Date.now() / 1000);
      const token = await signDeviceJwt(privateKey, {
        issuer,
        audience: DEVICE_JWT_AUDIENCE,
        deviceId,
        tokenId,
        nowSeconds,
        ttlSeconds: DEVICE_TOKEN_TTL_SECONDS,
      });
      await ctx.db.insert("device", { id: deviceId, tokenId, claimedAt: Date.now() });
      return { deviceId, token };
    } catch (error) {
      rethrow(error);
    }
  },
});

/**
 * Deletes the device row and bots whose names start with a smoke prefix.
 * Dev cleanup only. Refuses any other prefix so it cannot wipe real bots.
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
