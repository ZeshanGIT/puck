/**
 * Samples for the "Working now" card (H5, T82), as Home with running tasks and no backend:
 * `puck://dev-alert?sample=<name>` (dev builds only, see `App.tsx`). They follow the prototype's
 * "Sheldon works on a task" (with steps) and "Brow works on a task" (without steps).
 *
 * - `live-steps`: Sheldon with five steps, starting on the first. Every 3 s it moves on, adds a step
 *   midway ("Fixing a failing test", as the prototype does), and finishes (a tick, "Finished").
 * - `live-log`: Brow with no steps: the log grows by a line every 3 s, then finishes.
 * - `live-none`: Home with no running task (the section is hidden, "All quiet" shows).
 * - `live-done`: Sheldon's card already finished (the tick and "All steps done").
 *
 * Times are relative to the moment a sample is opened; `freshLive` turns them into real times.
 */
import type { LiveActivity } from "../../../liveCardModel";

const MINUTE = 60 * 1000;

export const LIVE_SAMPLE_NAMES = ["live-steps", "live-log", "live-none", "live-done"] as const;

export function isLiveSample(name: string): boolean {
  return (LIVE_SAMPLE_NAMES as readonly string[]).includes(name);
}

/** Moves a sample on by one tick (every 3 s); null when it is over. */
export type LiveScript = (activities: LiveActivity[], tick: number, now: number) => LiveActivity[] | null;

export interface LiveSample {
  activities: LiveActivity[];
  script: LiveScript | null;
}

const SHELDON_STEPS = [
  "Reading the issue",
  "Writing the fix",
  "Running the tests",
  "Building the APK",
  "Opening a pull request",
];

function sheldon(now: number, over: Partial<LiveActivity> = {}): LiveActivity {
  return {
    activityId: "live-sheldon",
    botId: "sheldon-23648",
    botName: "Sheldon",
    colour: "coral",
    title: "Fixing the swipe arm bug",
    steps: [...SHELDON_STEPS],
    stepIndex: 0,
    currentStep: SHELDON_STEPS[0]!,
    log: [],
    state: "running",
    link: null,
    startedAt: now - 5 * MINUTE,
    updatedAt: now,
    ...over,
  };
}

const BROW_SCRIPT = [
  "Looking through Downloads",
  "Sorting 214 files by type",
  "Archiving files older than 30 days",
  "Writing a short report",
];

function brow(now: number, over: Partial<LiveActivity> = {}): LiveActivity {
  return {
    activityId: "live-brow",
    botId: "brow-00007",
    botName: "Brow",
    colour: "violet",
    title: "Tidying your Downloads",
    steps: null,
    stepIndex: null,
    currentStep: BROW_SCRIPT[0]!,
    log: [],
    state: "running",
    link: null,
    startedAt: now - 2 * MINUTE,
    updatedAt: now,
    ...over,
  };
}

/** Sheldon's track: on, a step added after the third, on, then done. */
const stepsScript: LiveScript = (activities, tick, now) => {
  const a = activities[0];
  if (!a || a.steps === null || a.stepIndex === null || a.state !== "running") return null;
  let steps = a.steps;
  let index = a.stepIndex;
  if (index === 2 && !steps.includes("Fixing a failing test")) {
    steps = [...steps.slice(0, 3), "Fixing a failing test", ...steps.slice(3)];
    index = 3;
  } else {
    index += 1;
  }
  if (index >= steps.length) {
    return [{ ...a, steps, stepIndex: steps.length - 1, currentStep: steps[steps.length - 1] ?? "", state: "done", updatedAt: now }];
  }
  void tick;
  return [{ ...a, steps, stepIndex: index, currentStep: steps[index] ?? "", updatedAt: now }];
};

/** Brow's log: the current line moves into the log, the next becomes current, then done. */
const logScript: LiveScript = (activities, tick, now) => {
  const a = activities[0];
  if (!a || a.state !== "running") return null;
  const next = BROW_SCRIPT[tick];
  if (next === undefined) return [{ ...a, state: "done", updatedAt: now }];
  return [{ ...a, log: [...a.log, a.currentStep], currentStep: next, updatedAt: now }];
};

/** The named sample, or null for an unknown name. */
export function freshLive(name: string, now: number = Date.now()): LiveSample | null {
  switch (name) {
    case "live-steps":
      return { activities: [sheldon(now)], script: stepsScript };
    case "live-log":
      return { activities: [brow(now)], script: logScript };
    case "live-none":
      return { activities: [], script: null };
    case "live-done":
      return {
        activities: [sheldon(now, { stepIndex: SHELDON_STEPS.length - 1, currentStep: SHELDON_STEPS.at(-1)!, state: "done" })],
        script: null,
      };
    default:
      return null;
  }
}
