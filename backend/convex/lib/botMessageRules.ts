import type { Doc } from "../_generated/dataModel";
import { deliveryRoute } from "./builtInBot";

type Bot = Pick<Doc<"bots">, "userId" | "pairingState" | "removedAt" | "webhookUrl" | "builtIn">;


export function botMessageAccess(sender: Bot | null, target: Bot | null) {
  if (!sender?.userId || sender.pairingState !== "paired" || sender.removedAt !== undefined) {
    return { status: 403, error: "sending bot must be paired from a signed-in CLI" } as const;
  }
  if (!target || target.userId !== sender.userId || target.pairingState !== "paired" || target.removedAt !== undefined) {
    return { status: 404, error: "target bot is unavailable on your account" } as const;
  }
  if (deliveryRoute(target) !== "webhook") {
    return { status: 409, error: "target bot has no webhook" } as const;
  }
  return null;
}

const PAGE_BURST = 12;
const REFILL_MS = 5000;

export function takePageToken(bucket: { tokens: number; at: number } | undefined, now: number) {
  const tokens = bucket ? Math.min(PAGE_BURST, bucket.tokens + Math.max(0, now - bucket.at) / REFILL_MS) : PAGE_BURST;
  return tokens < 1 ? null : { tokens: tokens - 1, at: now };
}
