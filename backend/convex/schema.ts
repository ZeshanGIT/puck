import {
  ALERT_STATUSES,
  ANSWER_SOURCES,
  DELIVERY_STATUSES,
  PAIRING_STATES,
  PRIORITIES,
  SELECTION_MODES,
} from "@puck/shared";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// v0 tables. See the vault spec: bots, the alert, and the answer payload.
// Timestamps are Unix epoch milliseconds. Convex also adds _id and _creationTime.
// `bots.id` is the public id (sheldon-23648), not the document _id.
// `bots.webhookHeader` is ciphertext. The secret is stored only as secretHash.
// `routine` is the label sent as `routine` in the answer payload. The spec's
// bots table has no separate column for it; the payload does.

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

export const priority = v.union(...literals(PRIORITIES));
export const selectionMode = v.union(...literals(SELECTION_MODES));
export const alertStatus = v.union(...literals(ALERT_STATUSES));
export const pairingState = v.union(...literals(PAIRING_STATES));
export const answerSource = v.union(...literals(ANSWER_SOURCES));
export const deliveryStatus = v.union(...literals(DELIVERY_STATUSES));

export const option = v.object({
  id: v.string(),
  label: v.string(),
  icon: v.optional(v.string()),
});

export const answerChoice = v.object({
  id: v.string(),
  label: v.string(),
});

export default defineSchema({
  bots: defineTable({
    id: v.string(),
    name: v.string(),
    secretHash: v.string(),
    webhookUrl: v.string(),
    webhookHeader: v.string(),
    routine: v.string(),
    pairingState,
    pairingCodeHash: v.optional(v.string()),
    pairingCodeExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_publicId", ["id"])
    .index("by_pairingCodeHash", ["pairingCodeHash"])
    .index("by_pairingState", ["pairingState"]),

  // One phone. The secret is stored only as a hash. A second claim is rejected.
  device: defineTable({
    id: v.string(),
    secretHash: v.string(),
    tokenId: v.string(),
    claimedAt: v.number(),
  }).index("by_secretHash", ["secretHash"]),

  alerts: defineTable({
    questionId: v.string(),
    botId: v.id("bots"),
    question: v.string(),
    priority,
    selectionMode,
    options: v.array(option),
    status: alertStatus,
    scheduledFor: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_questionId", ["questionId"])
    .index("by_bot", ["botId"])
    .index("by_status", ["status"]),

  answers: defineTable({
    alertId: v.id("alerts"),
    questionId: v.string(),
    answers: v.array(answerChoice),
    customReply: v.union(v.string(), v.null()),
    source: answerSource,
    answeredAt: v.number(),
    deliveryStatus,
    deliveryAttempts: v.number(),
    lastError: v.optional(v.string()),
  })
    .index("by_alert", ["alertId"])
    .index("by_questionId", ["questionId"]),
});
