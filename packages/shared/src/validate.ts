import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_OPTIONS,
  type AlertExtras,
  type AlertLink,
  type AlertOption,
  type AnswerChoice,
  type AttachmentMeta,
  type AttachmentType,
  type CreateAlertInput,
  type OptionTone,
  type PairingInput,
  type Priority,
  type RecordedAnswer,
  type Presentation,
  type SelectionMode,
  OPTION_TONES,
  PRESENTATIONS,
  PRIORITIES,
  SELECTION_MODES,
  SNOOZE_MAX_MS,
  SWIPE_MAX_OPTIONS,
} from "./model";

export class AlertValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertValidationError";
  }
}

const OPTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
/** Control characters except tab, newline and carriage return, for multi-line text. */
const MULTILINE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTTP_URL_PREFIX = /^https?:\/\//i;
const WHITESPACE = /\s/;

const MESSAGE_MAX = 1_000;
const DETAILS_MAX = 4_000;
const OPTION_DESC_MAX = 200;
const LINK_LABEL_MAX = 40;
const LINK_URL_MAX = 2_048;
const RING_SECONDS_MIN = 5;
const RING_SECONDS_MAX = 600;

function fail(message: string): never {
  throw new AlertValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  return value;
}

function oneLine(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) fail(`${field} is required`);
  if (trimmed.length > max) fail(`${field} is too long`);
  if (CONTROL_CHARS.test(trimmed)) fail(`${field} must be one line`);
  return trimmed;
}

function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

function isSelectionMode(value: string): value is SelectionMode {
  return (SELECTION_MODES as readonly string[]).includes(value);
}

function isPresentation(value: string): value is Presentation {
  return (PRESENTATIONS as readonly string[]).includes(value);
}

function isTone(value: string): value is OptionTone {
  return (OPTION_TONES as readonly string[]).includes(value);
}

/** Undefined and null both mean absent. Anything else must be a real boolean. */
function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") fail(`${field} must be true or false`);
  return value;
}

/** Multi-line text, trimmed. Undefined and null mean absent. */
function multilineText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = requiredString(value, field).trim();
  if (!text) fail(`${field} is required`);
  if (text.length > max) fail(`${field} is too long`);
  if (MULTILINE_CONTROL_CHARS.test(text)) fail(`${field} contains a control character`);
  return text;
}

function parseLink(value: unknown): AlertLink {
  if (!isRecord(value)) fail("link must be an object with label and url");
  const label = oneLine(requiredString(value.label, "link.label"), "link.label", LINK_LABEL_MAX);
  const url = requiredString(value.url, "link.url");
  if (!HTTP_URL_PREFIX.test(url)) fail("link.url must start with https:// or http://");
  if (url.length > LINK_URL_MAX) fail("link.url is too long");
  if (WHITESPACE.test(url)) fail("link.url must not contain whitespace");
  try {
    new URL(url);
  } catch {
    fail("link.url must be a valid URL");
  }
  return { label, url };
}

function parseOption(value: unknown, index: number): AlertOption {
  if (!isRecord(value)) fail(`options[${index}] must be an object`);
  const id = oneLine(requiredString(value.id, `options[${index}].id`), `options[${index}].id`, 32);
  if (!OPTION_ID_PATTERN.test(id)) {
    fail(`options[${index}].id must be a short lowercase id`);
  }
  const label = oneLine(
    requiredString(value.label, `options[${index}].label`),
    `options[${index}].label`,
    80,
  );
  const option: AlertOption = { id, label };
  if (value.icon !== undefined && value.icon !== null && value.icon !== "") {
    option.icon = oneLine(requiredString(value.icon, `options[${index}].icon`), `options[${index}].icon`, 32);
  }
  if (value.desc !== undefined && value.desc !== null) {
    option.desc = oneLine(requiredString(value.desc, `options[${index}].desc`), `options[${index}].desc`, OPTION_DESC_MAX);
  }
  if (value.tone !== undefined && value.tone !== null) {
    const toneRaw = requiredString(value.tone, `options[${index}].tone`);
    if (!isTone(toneRaw)) fail(`options[${index}].tone must be destructive`);
    option.tone = toneRaw;
  }
  const rec = optionalBoolean(value.rec, `options[${index}].rec`);
  if (rec !== undefined) option.rec = rec;
  return option;
}

/** The optional alert fields. Only the ones present in the body are set on the result. */
function parseExtras(body: Record<string, unknown>): AlertExtras {
  const extras: AlertExtras = {};
  const message = multilineText(body.message, "message", MESSAGE_MAX);
  if (message !== undefined) extras.message = message;
  // Blank details are treated as absent, the same as a blank icon.
  const blankDetails = typeof body.details === "string" && body.details.trim() === "";
  const details = blankDetails ? undefined : multilineText(body.details, "details", DETAILS_MAX);
  if (details !== undefined) extras.details = details;
  if (body.link !== undefined && body.link !== null) extras.link = parseLink(body.link);
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== "number" || !Number.isInteger(body.expiresAt) || body.expiresAt <= 0) {
      fail("expiresAt must be epoch milliseconds");
    }
    extras.expiresAt = body.expiresAt;
  }
  if (body.ringSeconds !== undefined && body.ringSeconds !== null) {
    if (
      typeof body.ringSeconds !== "number" ||
      !Number.isInteger(body.ringSeconds) ||
      body.ringSeconds < RING_SECONDS_MIN ||
      body.ringSeconds > RING_SECONDS_MAX
    ) {
      fail(`ringSeconds must be a whole number from ${RING_SECONDS_MIN} to ${RING_SECONDS_MAX}`);
    }
    extras.ringSeconds = body.ringSeconds;
  }
  const speak = optionalBoolean(body.speak, "speak");
  if (speak !== undefined) extras.speak = speak;
  const bypassDnd = optionalBoolean(body.bypassDnd, "bypassDnd");
  if (bypassDnd !== undefined) extras.bypassDnd = bypassDnd;
  const bypassSilent = optionalBoolean(body.bypassSilent, "bypassSilent");
  if (bypassSilent !== undefined) extras.bypassSilent = bypassSilent;
  const requiresUnlock = optionalBoolean(body.requiresUnlock, "requiresUnlock");
  if (requiresUnlock !== undefined) extras.requiresUnlock = requiresUnlock;
  return extras;
}

/** Check a `POST /alerts` body. Priority and selection mode are required. */
export function validateCreateAlert(body: unknown): CreateAlertInput {
  if (!isRecord(body)) fail("body must be a JSON object");
  const question = oneLine(requiredString(body.question, "question"), "question", 500);
  const priorityRaw = requiredString(body.priority, "priority");
  if (!isPriority(priorityRaw)) fail("priority must be normal or urgent");
  const selectionRaw = requiredString(body.selectionMode, "selectionMode");
  if (!isSelectionMode(selectionRaw)) fail("selectionMode must be single or multi");
  let presentation: Presentation = "choice";
  if (body.presentation !== undefined && body.presentation !== null) {
    const presentationRaw = requiredString(body.presentation, "presentation");
    if (!isPresentation(presentationRaw)) fail("presentation must be choice or swipe");
    presentation = presentationRaw;
  }
  if (body.options === undefined) fail("options is required");
  if (!Array.isArray(body.options)) fail("options must be an array");
  if (body.options.length > MAX_OPTIONS) fail(`at most ${MAX_OPTIONS} options`);
  const options = body.options.map((option, index) => parseOption(option, index));
  const ids = new Set<string>();
  for (const option of options) {
    if (ids.has(option.id)) fail(`duplicate option id ${option.id}`);
    ids.add(option.id);
  }
  if (options.filter((option) => option.rec === true).length > 1) {
    fail("at most one option can be recommended (rec)");
  }
  if (presentation === "swipe") {
    if (selectionRaw !== "single") fail("a swipe alert is a single choice");
    if (options.length < 1 || options.length > SWIPE_MAX_OPTIONS) {
      fail("a swipe alert needs one or two options");
    }
  }
  let scheduledFor: number | null = null;
  if (body.scheduledFor !== undefined && body.scheduledFor !== null) {
    if (typeof body.scheduledFor !== "number" || !Number.isInteger(body.scheduledFor) || body.scheduledFor < 0) {
      fail("scheduledFor must be epoch milliseconds");
    }
    scheduledFor = body.scheduledFor;
  }
  return {
    question,
    priority: priorityRaw,
    selectionMode: selectionRaw,
    presentation,
    options,
    scheduledFor,
    ...parseExtras(body),
  };
}

/**
 * Checks the alert's times against `now` (epoch ms). Only the create path calls it: an alert
 * stored earlier may legitimately be past its expiry by the time it is read.
 */
export function validateAlertTiming(input: Pick<CreateAlertInput, "scheduledFor" | "expiresAt">, now: number): void {
  if (input.expiresAt !== undefined && input.expiresAt <= now) fail("expiresAt must be in the future");
  if (input.expiresAt !== undefined && input.scheduledFor !== null && input.expiresAt <= input.scheduledFor) {
    fail("expiresAt must be after scheduledFor");
  }
}

/**
 * Check a reply against the alert that was stored.
 * Single mode accepts at most one option. A custom reply can stand alone or sit beside options.
 * With `hasAttachments` the attachments can stand alone too (a photo with no words).
 */
export function validateAnswer(input: {
  selectionMode: SelectionMode;
  options: AlertOption[];
  optionIds: unknown;
  customReply?: unknown;
  hasAttachments?: boolean;
}): RecordedAnswer {
  if (!Array.isArray(input.optionIds)) fail("optionIds must be an array");
  if (input.optionIds.length > input.options.length) fail("too many option ids");
  const byId = new Map(input.options.map((option) => [option.id, option]));
  const answers: AnswerChoice[] = [];
  const seen = new Set<string>();
  for (const raw of input.optionIds) {
    if (typeof raw !== "string") fail("optionIds must be strings");
    const option = byId.get(raw);
    if (!option) fail(`unknown option id ${raw}`);
    if (seen.has(raw)) fail(`duplicate option id ${raw}`);
    seen.add(raw);
    answers.push({ id: option.id, label: option.label });
  }
  if (input.selectionMode === "single" && answers.length > 1) {
    fail("single selection accepts at most one option");
  }
  let customReply: string | null = null;
  if (input.customReply !== undefined && input.customReply !== null) {
    const text = requiredString(input.customReply, "customReply").trim();
    if (text) customReply = oneLine(text, "customReply", 2_000);
  }
  if (answers.length === 0 && customReply === null && input.hasAttachments !== true) {
    fail("choose an option or send a custom reply");
  }
  return { answers, customReply };
}

const ATTACHMENT_NAME_MAX = 255;
const ATTACHMENT_MIME_MAX = 127;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function isAttachmentType(value: string): value is AttachmentType {
  return (ATTACHMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Check the attachment list of a reply: at most `MAX_ATTACHMENTS`, each `{type, name, mime, size}`
 * with a size from 0 to `MAX_ATTACHMENT_BYTES`. Undefined and null mean no attachments.
 * `size` is what the phone claims; the backend replaces it with the stored file's real size.
 */
export function validateAttachments(value: unknown): AttachmentMeta[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("attachments must be an array");
  if (value.length > MAX_ATTACHMENTS) fail(`at most ${MAX_ATTACHMENTS} attachments`);
  return value.map((raw, index) => {
    const field = `attachments[${index}]`;
    if (!isRecord(raw)) fail(`${field} must be an object`);
    const type = requiredString(raw.type, `${field}.type`);
    if (!isAttachmentType(type)) fail(`${field}.type must be photo or file`);
    const name = oneLine(requiredString(raw.name, `${field}.name`), `${field}.name`, ATTACHMENT_NAME_MAX);
    const mime = requiredString(raw.mime, `${field}.mime`).trim();
    if (mime.length > ATTACHMENT_MIME_MAX || !MIME_PATTERN.test(mime)) {
      fail(`${field}.mime must be a media type such as image/jpeg`);
    }
    const size = raw.size;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
      fail(`${field}.size must be a whole number of bytes`);
    }
    if (size > MAX_ATTACHMENT_BYTES) fail(`${field} is over the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`);
    return { type, name, mime, size };
  });
}

/** Check the webhook URL and Authorization header Seshan pastes during pairing. */
export function validatePairingInput(body: unknown): PairingInput {
  if (!isRecord(body)) fail("body must be a JSON object");
  const name = oneLine(requiredString(body.name, "name"), "name", 32).toLowerCase();
  if (!NAME_PATTERN.test(name)) fail("name must be lowercase letters, digits and hyphens");
  const webhookUrl = oneLine(requiredString(body.webhookUrl, "webhookUrl"), "webhookUrl", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    fail("webhookUrl must be an https URL");
  }
  if (parsed.protocol !== "https:") fail("webhookUrl must be an https URL");
  if (parsed.username !== "" || parsed.password !== "") fail("webhookUrl must not include credentials");
  const webhookHeader = oneLine(
    requiredString(body.webhookHeader, "webhookHeader"),
    "webhookHeader",
    2_048,
  );
  let routine: string | null = null;
  if (body.routine !== undefined && body.routine !== null && body.routine !== "") {
    routine = oneLine(requiredString(body.routine, "routine"), "routine", 80);
  }
  return { name, webhookUrl, webhookHeader, routine };
}

/**
 * Check the time of a snooze. `null` is "until I'm back". A number is epoch milliseconds in the
 * future, at most `SNOOZE_MAX_MS` away. Returns the checked value.
 */
export function validateSnoozeUntil(until: unknown, now: number): number | null {
  if (until === null) return null;
  if (typeof until !== "number" || !Number.isInteger(until)) fail("until must be epoch milliseconds or null");
  if (until <= now) fail("until must be in the future");
  if (until > now + SNOOZE_MAX_MS) fail("a snooze can last at most 24 hours");
  return until;
}

/** An offline answer may carry the time it was given; older than this and it is not believed. */
export const ANSWERED_AT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The time to store for an answer. `answeredAt` is the phone's own time, sent with an answer that
 * waited offline (J11). It is used only when it is a whole number, not in the future and not more
 * than 24 hours old; anything else (missing, in the future, too old, not a number) is ignored and
 * `now`, the server's time, is used.
 */
export function resolveAnsweredAt(answeredAt: unknown, now: number): number {
  if (typeof answeredAt !== "number" || !Number.isInteger(answeredAt)) return now;
  if (answeredAt > now) return now;
  if (now - answeredAt > ANSWERED_AT_MAX_AGE_MS) return now;
  return answeredAt;
}
