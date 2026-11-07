/**
 * The logic behind the "Working now" card (H5, `ui/LiveCard.tsx`): where the blob rides on the track,
 * which stops are done, the words ("Working · 5 min", "3 to go"), the log's lines, and what to do
 * with an activity that has left the running list. Plain TypeScript, no React, so it can be tested.
 */
import type { LiveState } from "@puck/shared";
import { requestedColour } from "./pairingModel";
import type { BlobBot } from "./ui/blobShapes";
import { botLook } from "./ui/botLook";

/** One live activity, as `live.forUser` and `live.forBot` return it. */
export interface LiveActivity {
  activityId: string;
  botId: string;
  botName: string;
  colour: string | null;
  title: string;
  /** The steps of a task with a track; null without. */
  steps: string[] | null;
  stepIndex: number | null;
  currentStep: string;
  /** The last finished steps, oldest first (a task without a track). */
  log: string[];
  state: LiveState;
  link: { label: string; url: string } | null;
  startedAt: number;
  updatedAt: number;
}

const MINUTE = 60_000;

/** How the bot looks: its own colour, else the one derived from its id. */
export function liveLook(activity: Pick<LiveActivity, "botId" | "botName" | "colour">): BlobBot {
  const colour = requestedColour(activity.colour);
  return botLook({ botId: activity.botId, botName: activity.botName, ...(colour === null ? {} : { colour }) });
}

/** True for a task with a track: at least one step and a current place on it. */
export function hasTrack(activity: Pick<LiveActivity, "steps" | "stepIndex">): activity is { steps: string[]; stepIndex: number } & typeof activity {
  return activity.steps !== null && activity.steps.length > 0 && activity.stepIndex !== null;
}

/** The index of the current step, held inside the list. */
export function currentIndex(activity: { steps: string[]; stepIndex: number }): number {
  return Math.max(0, Math.min(activity.stepIndex, activity.steps.length - 1));
}

/** Where each stop sits along the track, 0 to 1 (`j/(n-1)`; a single stop is at the start). */
export function stopFractions(count: number): number[] {
  return Array.from({ length: count }, (_, j) => (count > 1 ? j / (count - 1) : 0));
}

/** Where the blob rides, 0 to 1: at the current stop, or at the end once done (`livePos`). */
export function trackFraction(activity: { steps: string[]; stepIndex: number; state: LiveState }): number {
  if (activity.state === "done") return 1;
  const n = activity.steps.length;
  return n > 1 ? currentIndex(activity) / (n - 1) : 0;
}

/** How many stops are filled in: those before the current one, or all of them once done. */
export function doneStops(activity: { steps: string[]; stepIndex: number; state: LiveState }): number {
  return activity.state === "done" ? activity.steps.length : currentIndex(activity);
}

/** "just started", "5 min", or "1 h 20 min". */
export function elapsedText(startedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / MINUTE);
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** The line under the bot's name: "Working · 5 min", "Finished · 5 min", "Didn't finish", "Stopped updating". */
export function statusText(activity: Pick<LiveActivity, "state" | "startedAt">, now: number): string {
  const elapsed = elapsedText(activity.startedAt, now);
  switch (activity.state) {
    case "running":
      return elapsed === "just started" ? "Working · just started" : `Working · ${elapsed}`;
    case "done":
      return elapsed === "just started" ? "Finished" : `Finished · ${elapsed}`;
    case "failed":
      return "Didn't finish";
    case "stale":
      return "Stopped updating";
  }
}

/** Under the track: the current step on the left and "3 to go" on the right ("All steps done" once done). */
export function stepSummary(activity: { steps: string[]; stepIndex: number; state: LiveState }): {
  step: string;
  toGo: string | null;
} {
  if (activity.state === "done") return { step: "All steps done", toGo: null };
  const i = currentIndex(activity);
  const left = activity.steps.length - 1 - i;
  return { step: activity.steps[i] ?? "", toGo: left > 0 ? `${left} to go` : "last step" };
}

/**
 * The log of a task with no track: the last two finished steps (grey, with ticks) and the current
 * one in bold. With nothing current yet, the newest finished step stands in.
 */
export function logLines(activity: Pick<LiveActivity, "log" | "currentStep" | "state">): {
  finished: string[];
  current: string;
} {
  const current = activity.currentStep.trim();
  if (current !== "") return { finished: activity.log.slice(-2), current };
  const last = activity.log[activity.log.length - 1] ?? "";
  return { finished: activity.log.slice(-3, -1), current: last };
}

/** The activities that were in `before` and are not in `after`: they ended, or were replaced. */
export function departedActivities(before: readonly LiveActivity[], after: readonly LiveActivity[]): LiveActivity[] {
  const stillThere = new Set(after.map((activity) => activity.activityId));
  return before.filter((activity) => !stillThere.has(activity.activityId));
}

/**
 * How a departed activity ended, from `live.forBot` for its bot: the state it ended in, or null when
 * there is nothing to show (the answer has not come, the bot has a newer task, or it is still running).
 */
export function endedState(departed: Pick<LiveActivity, "activityId">, current: Pick<LiveActivity, "activityId" | "state"> | null | undefined): LiveState | null {
  if (!current || current.activityId !== departed.activityId || current.state === "running") return null;
  return current.state;
}

/** How long an ended card stays on Home before it goes (the prototype clears it after 2.6 s). */
export const ENDED_CARD_MS = 3_000;
