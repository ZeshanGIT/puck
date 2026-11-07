// Pure rules for a live activity's track (N8, H5) and its stale check. No database access here.

import { AlertValidationError, LIVE_LOG_MAX, LIVE_MAX_STEPS, LIVE_STALE_MS } from "@puck/shared";
import { alertPushMode } from "./botSettings";

/** Where the bot is. With steps, `stepIndex` points into `steps`; without, `currentStep` is free text. */
export interface Track {
  steps: string[] | null;
  stepIndex: number | null;
  currentStep: string;
  log: string[];
}

/** A new activity's track: the first step is current, or no steps and no current text yet. */
export function startTrack(steps: string[] | null): Track {
  if (steps === null || steps.length === 0) return { steps: null, stepIndex: null, currentStep: "", log: [] };
  return { steps: [...steps], stepIndex: 0, currentStep: steps[0] ?? "", log: [] };
}

function pushLog(log: string[], finished: string): string[] {
  if (finished === "") return log;
  return [...log, finished].slice(-LIVE_LOG_MAX);
}

/**
 * `step`: move to that step. On a track, a step already on the list becomes current; a new one is
 * inserted right after the current step (so the rest of the work keeps its order) and becomes
 * current. Without a track, the previous text goes to the log.
 */
export function applyStep(track: Track, step: string): Track {
  if (track.steps === null) {
    if (step === track.currentStep) return track;
    return { ...track, currentStep: step, log: pushLog(track.log, track.currentStep) };
  }
  const existing = track.steps.indexOf(step);
  if (existing >= 0) return { ...track, stepIndex: existing, currentStep: step };
  if (track.steps.length >= LIVE_MAX_STEPS) throw new AlertValidationError(`at most ${LIVE_MAX_STEPS} steps`);
  const position = (track.stepIndex ?? track.steps.length - 1) + 1;
  const steps = [...track.steps.slice(0, position), step, ...track.steps.slice(position)];
  return { ...track, steps, stepIndex: position, currentStep: step };
}

/**
 * `steps`: replace the list. The current step stays current if it is still on the list, else the
 * first step is.
 */
export function applySteps(track: Track, steps: string[]): Track {
  const kept = steps.indexOf(track.currentStep);
  const stepIndex = kept >= 0 ? kept : 0;
  return { ...track, steps: [...steps], stepIndex, currentStep: steps[stepIndex] ?? "" };
}

/** Running with no update for LIVE_STALE_MS or more. The scheduled check does the same; this covers a missed one. */
export function isStale(updatedAt: number, now: number): boolean {
  return now - updatedAt >= LIVE_STALE_MS;
}

/** The state to show: a running activity past the stale window is stale. */
export function effectiveState(row: { state: string; updatedAt: number }, now: number): string {
  return row.state === "running" && isStale(row.updatedAt, now) ? "stale" : row.state;
}

/**
 * Whether a change to a live activity is pushed to the owner's phones. A muted bot's activity still
 * shows on the owner's home (H5); it just does not push (the same rule as alerts, T62).
 */
export function liveSendMode(bot: { mutedUntil?: number }, hasOwner: boolean, now: number): "push" | "muted" | "no owner" {
  if (!hasOwner) return "no owner";
  return alertPushMode(bot, now);
}
