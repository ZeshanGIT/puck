// Clerk identity for the clients functions. Other modules import `requireUser` and
// `requireClient` from here, not from `clients.ts`.

import { DEV_CLERK_FRONTEND_API } from "@puck/shared";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { CLIENT_NOT_FOUND, clerkSubject } from "./clientRules";

type ClientReadCtx = MutationCtx | QueryCtx;

/** Issuer of the Clerk `convex` JWT template, and the `domain` in `auth.config.ts`. No trailing slash. */
export function clerkIssuer(): string {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const configured = runtime.process?.env?.CLERK_FRONTEND_API_URL?.trim();
  return (configured || `https://${DEV_CLERK_FRONTEND_API}`).replace(/\/+$/u, "");
}

/** The Clerk user id (`subject`). Throws `unauthorized` with no identity or with the device JWT. */
export async function requireUser(ctx: ClientReadCtx): Promise<string> {
  return clerkSubject(await ctx.auth.getUserIdentity(), clerkIssuer());
}

/** The caller's client row. Another user's client, or one that does not exist, is `client not found`. */
export async function requireClient(ctx: ClientReadCtx, clientId: string): Promise<Doc<"clients">> {
  const userId = await requireUser(ctx);
  const id = ctx.db.normalizeId("clients", clientId);
  const client = id ? await ctx.db.get(id) : null;
  if (!client || client.userId !== userId) throw new Error(CLIENT_NOT_FOUND);
  return client;
}
