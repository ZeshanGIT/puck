import {
  ALERT_STATUSES,
  ANSWER_SOURCES,
  DELIVERY_STATUSES,
  OPTION_TONES,
  PAIRING_STATES,
  PRESENTATIONS,
  PRIORITIES,
  SELECTION_MODES,
} from "@puck/shared";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { CLIENT_PLATFORMS } from "./lib/clientRules";

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
export const presentation = v.union(...literals(PRESENTATIONS));
export const alertStatus = v.union(...literals(ALERT_STATUSES));
export const pairingState = v.union(...literals(PAIRING_STATES));
export const answerSource = v.union(...literals(ANSWER_SOURCES));
export const deliveryStatus = v.union(...literals(DELIVERY_STATUSES));

export const optionTone = v.union(...literals(OPTION_TONES));

export const option = v.object({
  id: v.string(),
  label: v.string(),
  icon: v.optional(v.string()),
  desc: v.optional(v.string()),
  tone: v.optional(optionTone),
  rec: v.optional(v.boolean()),
});

export const alertLink = v.object({ label: v.string(), url: v.string() });

/** The optional alert fields added after v0 (see `AlertExtras` in @puck/shared). All optional. */
export const alertExtraFields = {
  message: v.optional(v.string()),
  details: v.optional(v.string()),
  link: v.optional(alertLink),
  expiresAt: v.optional(v.number()),
  ringSeconds: v.optional(v.number()),
  speak: v.optional(v.boolean()),
  bypassDnd: v.optional(v.boolean()),
  bypassSilent: v.optional(v.boolean()),
  requiresUnlock: v.optional(v.boolean()),
};

export const clientPlatform = v.union(...literals(CLIENT_PLATFORMS));

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
    // True only for the built-in Puck bot (test pages). It has no webhook and cannot authenticate.
    builtIn: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_publicId", ["id"])
    .index("by_pairingCodeHash", ["pairingCodeHash"])
    .index("by_pairingState", ["pairingState"]),

  // One phone. The secret is stored only as a hash. A second claim is rejected.
  // pushToken is the FCM registration token. Logs must not print it.
  device: defineTable({
    id: v.string(),
    secretHash: v.string(),
    tokenId: v.string(),
    claimedAt: v.number(),
    pushToken: v.optional(v.string()),
    fullScreenAllowed: v.optional(v.boolean()),
  }).index("by_secretHash", ["secretHash"]),

  // A signed-in app or CLI install. `userId` is the Clerk user id (the identity `subject`).
  // The client id is this document's _id as a string. pushToken is the FCM registration token. Logs must not print it.
  clients: defineTable({
    userId: v.string(),
    name: v.string(),
    platform: clientPlatform,
    pushToken: v.optional(v.string()),
    fullScreenAllowed: v.optional(v.boolean()),
    dndAccess: v.optional(v.boolean()),
    lastSeenAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_name", ["userId", "name"]),

  alerts: defineTable({
    questionId: v.string(),
    botId: v.id("bots"),
    question: v.string(),
    priority,
    selectionMode,
    presentation: v.optional(presentation),
    options: v.array(option),
    status: alertStatus,
    scheduledFor: v.optional(v.number()),
    // A client id (a `clients` _id as a string). When set, only that client is pushed and sees the alert.
    targetClientId: v.optional(v.string()),
    // The client that answered, when it answered through a Clerk identity. Legacy device answers leave it unset.
    answeredByClientId: v.optional(v.id("clients")),
    ...alertExtraFields,
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
