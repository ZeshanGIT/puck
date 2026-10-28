import {
  MAX_OPTIONS,
  type AlertOption,
  type AnswerChoice,
  type CreateAlertInput,
  type PairingInput,
  type Priority,
  type RecordedAnswer,
  type SelectionMode,
  PRIORITIES,
  SELECTION_MODES,
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
  if (value.icon === undefined || value.icon === null || value.icon === "") {
    return { id, label };
  }
  const icon = oneLine(requiredString(value.icon, `options[${index}].icon`), `options[${index}].icon`, 32);
  return { id, label, icon };
}

/** Check a `POST /alerts` body. Priority and selection mode are required. */
export function validateCreateAlert(body: unknown): CreateAlertInput {
  if (!isRecord(body)) fail("body must be a JSON object");
  const question = oneLine(requiredString(body.question, "question"), "question", 500);
  const priorityRaw = requiredString(body.priority, "priority");
  if (!isPriority(priorityRaw)) fail("priority must be normal or urgent");
  const selectionRaw = requiredString(body.selectionMode, "selectionMode");
  if (!isSelectionMode(selectionRaw)) fail("selectionMode must be single or multi");
  if (body.options === undefined) fail("options is required");
  if (!Array.isArray(body.options)) fail("options must be an array");
  if (body.options.length > MAX_OPTIONS) fail(`at most ${MAX_OPTIONS} options`);
  const options = body.options.map((option, index) => parseOption(option, index));
  const ids = new Set<string>();
  for (const option of options) {
    if (ids.has(option.id)) fail(`duplicate option id ${option.id}`);
    ids.add(option.id);
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
    options,
    scheduledFor,
  };
}

/**
 * Check a reply against the alert that was stored.
 * Single mode accepts at most one option. A custom reply can stand alone or sit beside options.
 */
export function validateAnswer(input: {
  selectionMode: SelectionMode;
  options: AlertOption[];
  optionIds: unknown;
  customReply?: unknown;
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
  if (answers.length === 0 && customReply === null) {
    fail("choose an option or send a custom reply");
  }
  return { answers, customReply };
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
