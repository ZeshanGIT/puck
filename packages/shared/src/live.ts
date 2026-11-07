// Live activities (N8, H5): a bot says what it is working on, with steps and progress.
// Plain TypeScript. The backend stores it; the CLI and the app read the same limits.

import { AlertValidationError } from "./validate";

/** Running until the bot ends it, or one of the ended states. */
export const LIVE_STATES = ["running", "done", "failed", "stale"] as const;

export type LiveState = (typeof LIVE_STATES)[number];

/** A running activity with no update for this long is ended as stale ("Stopped updating"). */
export const LIVE_STALE_MS = 30 * 60 * 1000;

export const LIVE_TITLE_MAX = 80;
export const LIVE_STEP_MAX = 80;
export const LIVE_MAX_STEPS = 12;
/** The last finished steps kept for an activity without a track. */
export const LIVE_LOG_MAX = 10;
export const LIVE_LINK_URL_MAX = 2_048;

/** FCM data flag for a live activity update. Data-only, so the phone updates its ongoing notification. */
export const LIVE_KIND = "live";

/** One `POST /status` body, after validation. */
export type LiveCommand =
  | { action: "start"; title: string; steps: string[] | null; link: string | null }
  | { action: "step"; step: string }
  | { action: "steps"; steps: string[] }
  | { action: "end"; state: "done" | "failed" };

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function fail(message: string): never {
  throw new AlertValidationError(message);
}

function line(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) fail(`${field} is required`);
  if (trimmed.length > max) fail(`${field} is too long`);
  if (CONTROL_CHARS.test(trimmed)) fail(`${field} must be one line`);
  return trimmed;
}

function stepList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(`${field} must be an array of steps`);
  if (value.length === 0) fail(`${field} needs at least one step`);
  if (value.length > LIVE_MAX_STEPS) fail(`at most ${LIVE_MAX_STEPS} steps`);
  const steps = value.map((step, index) => line(step, `${field}[${index}]`, LIVE_STEP_MAX));
  if (new Set(steps).size !== steps.length) fail("steps must be distinct");
  return steps;
}

function linkUrl(value: unknown): string {
  const url = line(value, "link", LIVE_LINK_URL_MAX);
  if (!/^https?:\/\//i.test(url)) fail("link must start with https:// or http://");
  if (/\s/.test(url)) fail("link must not contain whitespace");
  try {
    new URL(url);
  } catch {
    fail("link must be a valid URL");
  }
  return url;
}

/** Checks a `POST /status` body, or throws AlertValidationError with a short message. */
export function validateLiveCommand(body: unknown): LiveCommand {
  if (typeof body !== "object" || body === null || Array.isArray(body)) fail("body must be a JSON object");
  const record = body as Record<string, unknown>;
  const action = record.action;
  if (action === "start") {
    const title = line(record.title, "title", LIVE_TITLE_MAX);
    const steps = record.steps === undefined || record.steps === null ? null : stepList(record.steps, "steps");
    const link = record.link === undefined || record.link === null ? null : linkUrl(record.link);
    return { action, title, steps, link };
  }
  if (action === "step") {
    return { action, step: line(record.step, "step", LIVE_STEP_MAX) };
  }
  if (action === "steps") {
    return { action, steps: stepList(record.steps, "steps") };
  }
  if (action === "end") {
    const state = record.state === undefined || record.state === null ? "done" : record.state;
    if (state !== "done" && state !== "failed") fail("state must be done or failed");
    return { action, state };
  }
  fail("action must be start, step, steps or end");
}
