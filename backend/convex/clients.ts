import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireClient, requireUser } from "./lib/clientAuth";
import {
  CLIENT_NAME_INVALID,
  CLIENT_NAME_TAKEN,
  CLIENT_PLATFORMS,
  MAX_CLIENTS_PER_USER,
  TOO_MANY_CLIENTS,
  decideRegistration,
  renameConflicts,
  validateClientName,
} from "./lib/clientRules";
import { isPushToken } from "./lib/fcm";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Clients sign in with the Clerk `convex` token. The client id is the row's _id as a string.
// Nothing here logs or returns a push token.

const platform = v.union(...CLIENT_PLATFORMS.map((value) => v.literal(value)));

type ReadCtx = MutationCtx | QueryCtx;

function cleanName(raw: string): string {
  const name = validateClientName(raw);
  if (!name) throw new Error(CLIENT_NAME_INVALID);
  return name;
}

async function sameName(ctx: ReadCtx, userId: string, name: string) {
  return ctx.db
    .query("clients")
    .withIndex("by_userId_name", (q) => q.eq("userId", userId).eq("name", name))
    .first();
}

/**
 * Register this install as a client. Same name and no `replace`: `exists`, nothing changes,
 * and the app asks "Replace Pixel 7?". With `replace` the row id stays and the push token is cleared.
 */
export const register = mutationGeneric({
  args: { name: v.string(), platform, replace: v.optional(v.boolean()) },
  returns: v.object({
    status: v.union(v.literal("created"), v.literal("replaced"), v.literal("exists")),
    clientId: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const name = cleanName(args.name);
    const existing = await sameName(ctx, userId, name);
    const owned = await ctx.db
      .query("clients")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(MAX_CLIENTS_PER_USER);
    const decision = decideRegistration({
      sameName: existing ? { id: existing._id } : null,
      replace: args.replace === true,
      clientCount: owned.length,
    });
    const now = Date.now();
    switch (decision.action) {
      case "exists":
        return { status: "exists" as const, clientId: decision.clientId };
      case "replace": {
        if (!existing) throw new Error("client not found");
        await ctx.db.patch(existing._id, {
          platform: args.platform,
          pushToken: undefined,
          lastSeenAt: now,
          createdAt: now,
        });
        return { status: "replaced" as const, clientId: existing._id as string };
      }
      case "full":
        throw new Error(TOO_MANY_CLIENTS);
      case "create": {
        const id = await ctx.db.insert("clients", {
          userId,
          name,
          platform: args.platform,
          lastSeenAt: now,
          createdAt: now,
        });
        return { status: "created" as const, clientId: id as string };
      }
    }
  },
});

export const rename = mutationGeneric({
  args: { clientId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const name = cleanName(args.name);
    const existing = await sameName(ctx, client.userId, name);
    if (renameConflicts(client._id, existing ? { id: existing._id } : null)) throw new Error(CLIENT_NAME_TAKEN);
    await ctx.db.patch(client._id, { name });
    return null;
  },
});

export const remove = mutationGeneric({
  args: { clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    await ctx.db.delete(client._id);
    return null;
  },
});

export const list = queryGeneric({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      platform,
      fullScreenAllowed: v.optional(v.boolean()),
      dndAccess: v.optional(v.boolean()),
      lastSeenAt: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("clients")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(MAX_CLIENTS_PER_USER);
    return rows.map((row) => ({
      id: row._id as string,
      name: row.name,
      platform: row.platform,
      ...(row.fullScreenAllowed === undefined ? {} : { fullScreenAllowed: row.fullScreenAllowed }),
      ...(row.dndAccess === undefined ? {} : { dndAccess: row.dndAccess }),
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
    }));
  },
});

export const setPushToken = mutationGeneric({
  args: { clientId: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    if (!isPushToken(args.token)) throw new Error("push token is not valid");
    await ctx.db.patch(client._id, { pushToken: args.token });
    return null;
  },
});

export const setFlags = mutationGeneric({
  args: {
    clientId: v.string(),
    fullScreenAllowed: v.optional(v.boolean()),
    dndAccess: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    const patch: { fullScreenAllowed?: boolean; dndAccess?: boolean } = {};
    if (args.fullScreenAllowed !== undefined) patch.fullScreenAllowed = args.fullScreenAllowed;
    if (args.dndAccess !== undefined) patch.dndAccess = args.dndAccess;
    if (Object.keys(patch).length > 0) await ctx.db.patch(client._id, patch);
    return null;
  },
});

export const touch = mutationGeneric({
  args: { clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await requireClient(ctx, args.clientId);
    await ctx.db.patch(client._id, { lastSeenAt: Date.now() });
    return null;
  },
});
