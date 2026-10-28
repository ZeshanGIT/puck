import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { ALERT_STATUSES } from "@puck/shared";

// Sketch of the v0 data model (see the Puck v0 spec in the vault).
// Timestamps are Unix epoch milliseconds; Convex adds _id and _creationTime.

export const alertStatus = v.union(
  ...ALERT_STATUSES.map((status) => v.literal(status)),
);

export const reply = v.union(
  v.object({ kind: v.literal("option"), option: v.string(), repliedAt: v.number() }),
  v.object({ kind: v.literal("text"), text: v.string(), repliedAt: v.number() }),
);

export default defineSchema({
  // One row per agent allowed to page Seshan. Only a hash of its key is stored.
  agents: defineTable({
    name: v.string(),
    keyHash: v.string(),
    revoked: v.boolean(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_keyHash", ["keyHash"])
    .index("by_name", ["name"]),

  alerts: defineTable({
    agentId: v.id("agents"),
    message: v.string(),
    options: v.array(v.string()), // at most MAX_OPTIONS (@puck/shared)
    allowText: v.boolean(),
    status: alertStatus,
    scheduledFor: v.optional(v.number()),
    webhookUrl: v.optional(v.string()),
    reply: v.optional(reply),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_status", ["status"])
    .index("by_status_scheduledFor", ["status", "scheduledFor"]),
});
