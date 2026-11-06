// Alert and answer shapes shared by the Convex backend, the Expo app and the CLI.
// Plain TypeScript with no runtime dependencies.

/** An alert can offer at most this many options. */
export const MAX_OPTIONS = 4;

/**
 * Unapproved bots. `createPairing` stops once this many are still pending,
 * so a claimed device cannot fill the table.
 */
export const PENDING_BOT_CAP = 5;

/** Audience (`aud`) of the one-device JWT. */
export const DEVICE_JWT_AUDIENCE = "puck";

/** `kid` of the device signing key, published in the JWKS. */
export const DEVICE_JWT_KID = "puck-device-1";

/**
 * How long an exchanged device JWT stays valid.
 * The device secret from claim is the long-lived credential; the app exchanges it again at `POST /device/token`.
 */
export const DEVICE_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Android notification channel for a heads-up alert.
 * The app creates it before the first push. Importance cannot be changed later,
 * so a new id is required if this channel is ever recreated at a lower level.
 */
export const PUSH_CHANNEL_ID = "puck-alerts";

/** Notifee channel for an urgent alert. Separate from the shade channel so its sound can stay on. */
export const PUSH_URGENT_CHANNEL_ID = "puck-urgent";

/** FCM data flag. The phone draws this alert itself so it can cover the lock screen. */
export const FULL_SCREEN_KIND = "fullscreen";

/** True when another pending bot would pass the cap. */
export function tooManyPendingBots(pendingCount: number): boolean {
  if (!Number.isInteger(pendingCount) || pendingCount < 0) {
    throw new Error("pending bot count must be a non-negative integer");
  }
  return pendingCount >= PENDING_BOT_CAP;
}

/** Lifecycle of an alert. Delivery of the answer is tracked separately. */
export const ALERT_STATUSES = [
  "scheduled", // scheduledFor is still in the future
  "pending", // waiting for a reply
  "answered", // a reply is stored; delivery may still be in progress
  "cancelled", // cancelled before a reply
] as const;

export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const PRIORITIES = ["normal", "urgent"] as const;

export type Priority = (typeof PRIORITIES)[number];

export const SELECTION_MODES = ["single", "multi"] as const;

export type SelectionMode = (typeof SELECTION_MODES)[number];

/** How the phone shows the alert. Swipe is still a single choice, not a third selection mode. */
export const PRESENTATIONS = ["choice", "swipe"] as const;

export type Presentation = (typeof PRESENTATIONS)[number];

/**
 * A swipe alert takes one or two options. With two, the first is on the left and the second on
 * the right. With one, the other side is Puck's Snooze (Q17).
 */
export const SWIPE_MAX_OPTIONS = 2;

/** Old name for `SWIPE_MAX_OPTIONS`, kept so existing imports still compile. */
export const SWIPE_OPTION_COUNT = SWIPE_MAX_OPTIONS;

/** Option tones. `destructive` is shown red and needs an unlock on the lock screen (Q9, Q10). */
export const OPTION_TONES = ["destructive"] as const;

export type OptionTone = (typeof OPTION_TONES)[number];

export const PAIRING_STATES = ["pending", "paired"] as const;

export type PairingState = (typeof PAIRING_STATES)[number];

export const ANSWER_SOURCES = ["app"] as const;

export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Attempts include the first try. Later tries wait 1s, 4s, then 16s. */
export const DELIVERY_MAX_ATTEMPTS = 4;

const DELIVERY_BACKOFF_MS = [1_000, 4_000, 16_000] as const;

/**
 * Delay before the next delivery try, after `attemptsSoFar` have already run.
 * `null` means the last attempt has been used.
 */
export function deliveryBackoffMs(attemptsSoFar: number): number | null {
  if (attemptsSoFar <= 0 || attemptsSoFar >= DELIVERY_MAX_ATTEMPTS) return null;
  return DELIVERY_BACKOFF_MS[attemptsSoFar - 1] ?? null;
}

/** One choice on an alert. `id` is stable; the label is what Seshan sees. */
export interface AlertOption {
  id: string;
  label: string;
  icon?: string;
  /** Description under the label. */
  desc?: string;
  tone?: OptionTone;
  /** RECOMMENDED tag. At most one option per alert may have it. */
  rec?: boolean;
}

/** "Open in ..." pill on an alert. */
export interface AlertLink {
  label: string;
  url: string;
}

/**
 * Optional alert fields added after v0. Each is omitted when absent, so old payloads and old
 * stored alerts keep their shape.
 */
export interface AlertExtras {
  /** Short text under the question. Basic formatting. */
  message?: string;
  /** Longer text behind Show more. */
  details?: string;
  link?: AlertLink;
  /** Epoch ms. After this the alert is Missed and can't be answered. */
  expiresAt?: number;
  /** How long an urgent alert rings. The phone defaults to 60. */
  ringSeconds?: number;
  speak?: boolean;
  bypassDnd?: boolean;
  bypassSilent?: boolean;
  requiresUnlock?: boolean;
}

/** One selected option inside an answer payload. Icons are not sent back. */
export interface AnswerChoice {
  id: string;
  label: string;
}

/** A reply can carry at most this many attachments (Protocol changes section 4). */
export const MAX_ATTACHMENTS = 5;

/** The largest attachment, in bytes (20 MB). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** A camera or gallery picture is a `photo`; anything else the phone attaches is a `file`. */
export const ATTACHMENT_TYPES = ["photo", "file"] as const;

export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** What the phone says about an uploaded file. The backend re-checks `size` against storage. */
export interface AttachmentMeta {
  type: AttachmentType;
  name: string;
  mime: string;
  size: number;
}

/** One attachment in the webhook payload: its metadata and a Convex storage URL to fetch it from. */
export interface AnswerAttachment extends AttachmentMeta {
  url: string;
}

/**
 * JSON body Convex POSTs to the asking bot's webhook.
 * Field order matches the v0 spec sample. `attachments` is present only when the reply has some.
 */
export interface AnswerPayload {
  questionId: string;
  question: string;
  bot: string;
  routine: string;
  priority: Priority;
  answers: AnswerChoice[];
  customReply: string | null;
  answeredAt: string;
  source: AnswerSource;
  attachments?: AnswerAttachment[];
}

/** Body accepted by `POST /alerts`. */
export interface CreateAlertInput extends AlertExtras {
  question: string;
  priority: Priority;
  selectionMode: SelectionMode;
  presentation: Presentation;
  options: AlertOption[];
  scheduledFor: number | null;
}

/** What `recordAnswer` keeps after checking the selection against the alert. */
export interface RecordedAnswer {
  answers: AnswerChoice[];
  customReply: string | null;
}

/** Fields `createPairing` accepts before it hashes the secret and encrypts the header. */
export interface PairingInput {
  name: string;
  webhookUrl: string;
  webhookHeader: string;
  routine: string | null;
}

/** Public bot id, for example `sheldon-23648`. The secret is a separate value. */
export const BOT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{5}$/;

/** Public question id, for example `q_01HV7K3M2Z`. */
export const QUESTION_ID_PATTERN = /^q_[0-9A-HJKMNP-TV-Z]{16}$/;

export const PAIRING_CODE_PATTERN = /^\d{6}$/;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ISO-8601 UTC with millisecond precision (`Date.toISOString`). */
export function isoUtc(epochMs: number): string {
  if (!Number.isInteger(epochMs)) {
    throw new Error("time must be epoch milliseconds");
  }
  return new Date(epochMs).toISOString();
}

export function isBotId(value: string): boolean {
  return BOT_ID_PATTERN.test(value);
}

export function isQuestionId(value: string): boolean {
  return QUESTION_ID_PATTERN.test(value);
}

/** Five-digit suffix, so `sheldon` and `42` become `sheldon-00042`. */
export function botPublicId(name: string, suffix: number): string {
  if (!Number.isInteger(suffix) || suffix < 0 || suffix > 99_999) {
    throw new Error("bot id suffix must be an integer from 0 to 99999");
  }
  return `${name}-${suffix.toString().padStart(5, "0")}`;
}

/** 16 Crockford characters. `nextByte` supplies a uniform byte (Convex uses `Math.random`). */
export function questionIdFromBytes(nextByte: () => number): string {
  let id = "q_";
  for (let i = 0; i < 16; i++) {
    const byte = nextByte();
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error("question id byte must be an integer from 0 to 255");
    }
    const alphabetIndex = byte & 31;
    const char = CROCKFORD[alphabetIndex];
    if (char === undefined) throw new Error("question id alphabet miss");
    id += char;
  }
  return id;
}

export function formatPairingCode(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999) {
    throw new Error("pairing code must be an integer from 0 to 999999");
  }
  return value.toString().padStart(6, "0");
}
