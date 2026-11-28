// Database side of alert ownership (see `ownership.ts` for the rules). Every read or write of an
// alert on behalf of a client goes through here, so one user never meets another user's alerts.

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { deriveAlertOwner, ownerMayAccess, type Viewer } from "./ownership";

type Ctx = MutationCtx | QueryCtx;
type Alert = Doc<"alerts">;
type AlertStatus = Alert["status"];

/**
 * An alert row with loose field types. The `...Generic` handlers in this backend see rows with
 * `any` fields (their ctx has no data model), and the app's API types are inferred from what they
 * return, so rows read here keep that shape instead of the schema's widened `string` unions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AlertRow = { [K in keyof Alert]: any };

/** Per-call cache so a page of alerts reads each bot and client once. */
export interface OwnerCache {
  bots: Map<string, Doc<"bots"> | null>;
  clientUsers: Map<string, string | null>;
}

export function newOwnerCache(): OwnerCache {
  return { bots: new Map(), clientUsers: new Map() };
}

/** The owner of an alert: its stored `userId`, else derived from its bot (or target client). */
export async function alertOwner(ctx: Ctx, alert: Alert, cache: OwnerCache = newOwnerCache()): Promise<string | null> {
  if (alert.userId) return alert.userId;
  const botKey = alert.botId as string;
  if (!cache.bots.has(botKey)) cache.bots.set(botKey, await ctx.db.get(alert.botId));
  const bot = cache.bots.get(botKey) ?? null;
  let targetClientUserId: string | null = null;
  if (bot?.builtIn === true && alert.targetClientId) {
    const key = alert.targetClientId;
    if (!cache.clientUsers.has(key)) {
      const id = ctx.db.normalizeId("clients", key);
      const client = id ? await ctx.db.get(id) : null;
      cache.clientUsers.set(key, client?.userId ?? null);
    }
    targetClientUserId = cache.clientUsers.get(key) ?? null;
  }
  return deriveAlertOwner({ alertUserId: alert.userId, bot, targetClientUserId });
}

/** Whether the viewer owns the alert (device: only an ownerless one). */
export async function viewerMayAccess(
  ctx: Ctx,
  alert: Alert,
  viewer: Viewer,
  cache: OwnerCache = newOwnerCache(),
): Promise<boolean> {
  return ownerMayAccess(await alertOwner(ctx, alert, cache), viewer);
}

/**
 * The viewer's alerts with one status, oldest first: rows stamped with their `userId` through the
 * user index, plus legacy rows with no `userId` yet (until the backfill has run) whose derived
 * owner is the viewer. The device sees only ownerless rows. At most `limit` from each source.
 */
export async function alertsByStatusFor(
  ctx: Ctx,
  viewer: Viewer,
  status: AlertStatus,
  limit: number,
  cache: OwnerCache = newOwnerCache(),
): Promise<AlertRow[]> {
  const stamped =
    viewer.kind === "user"
      ? await ctx.db
          .query("alerts")
          .withIndex("by_user_status", (q) => q.eq("userId", viewer.userId).eq("status", status))
          .take(limit)
      : [];
  const legacy = await ctx.db
    .query("alerts")
    .withIndex("by_user_status", (q) => q.eq("userId", undefined).eq("status", status))
    .take(limit);
  const mine: AlertRow[] = [...stamped];
  for (const alert of legacy) {
    if (await viewerMayAccess(ctx, alert, viewer, cache)) mine.push(alert);
  }
  return mine.sort((a, b) => a._creationTime - b._creationTime);
}
