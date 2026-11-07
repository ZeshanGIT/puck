/**
 * The pure half of the N8 ongoing notification: what it says for a live-activity push, its
 * progress numbers, what happens when the activity ends, and which pushes to ignore (late ones,
 * ones for a task a newer task replaced). No React Native or Notifee here, so it can be tested;
 * `liveNotification.ts` hands the result to Notifee.
 */
import type { LivePush } from "./livePayload";
import { PALETTE } from "./ui/botTheme";

/** How long the closing line ("Finished") stays in the shade before it clears itself. */
export const FINAL_LINE_MS = 6_000;

export function liveNotificationId(activityId: string): string {
  return `live-${activityId}`;
}

export function isEnded(state: LivePush["state"]): boolean {
  return state !== "running";
}

/** Steps still to do after the current one, or null with no track. */
export function stepsToGo(push: Pick<LivePush, "stepIndex" | "stepCount">): number | null {
  if (push.stepIndex === null || push.stepCount === null) return null;
  return Math.max(0, push.stepCount - 1 - push.stepIndex);
}

/** The progress bar: steps finished out of all steps. Null with no track (no bar at all). */
export function liveProgress(push: Pick<LivePush, "stepIndex" | "stepCount" | "state">): { max: number; current: number } | null {
  if (push.stepIndex === null || push.stepCount === null || push.stepCount < 1) return null;
  const max = push.stepCount;
  return { max, current: push.state === "done" ? max : Math.min(push.stepIndex, max) };
}

export interface LiveNotificationSpec {
  id: string;
  /** The task. */
  title: string;
  /** The current step, and how many are to go. */
  body: string;
  /** The bot's name, where Android shows a notification's sub text. */
  subtitle: string;
  progress: { max: number; current: number } | null;
  /** The chronometer counts up from here; null on the closing line. */
  chronometerFrom: number | null;
  /** True while the task runs: it cannot be swiped away. */
  ongoing: boolean;
  /** Android clears the closing line by itself after this long. */
  timeoutAfter: number | null;
  /** The bot's base colour, for the notification's accent. */
  colour: string | null;
}

/** The closing line for an ended activity. */
export function closingLine(state: LivePush["state"]): string {
  switch (state) {
    case "done":
      return "Finished";
    case "failed":
      return "Didn't finish";
    case "stale":
      return "Stopped updating";
    case "running":
      return "";
  }
}

function baseColour(push: Pick<LivePush, "colour">): string | null {
  return push.colour === null ? null : (PALETTE.find((entry) => entry.name === push.colour)?.base ?? null);
}

/** What the notification shows for this push. A running task is ongoing; an ended one is a brief closing line. */
export function liveNotificationSpec(push: LivePush): LiveNotificationSpec {
  const common = {
    id: liveNotificationId(push.activityId),
    title: push.title,
    subtitle: push.botName,
    colour: baseColour(push),
  };
  if (isEnded(push.state)) {
    return {
      ...common,
      body: closingLine(push.state),
      progress: push.state === "done" ? liveProgress(push) : null,
      chronometerFrom: null,
      ongoing: false,
      timeoutAfter: FINAL_LINE_MS,
    };
  }
  const toGo = stepsToGo(push);
  const step = push.currentStep.trim() === "" ? "Working" : push.currentStep;
  return {
    ...common,
    body: toGo === null ? step : `${step} · ${toGo === 0 ? "last step" : `${toGo} to go`}`,
    progress: liveProgress(push),
    chronometerFrom: push.startedAt,
    ongoing: true,
    timeoutAfter: null,
  };
}

/** What the phone has shown so far, per activity, so pushes arriving late or out of order do no harm. */
export interface LiveSeen {
  /** `updatedAt` of the last push applied, and whether it ended the activity. */
  byActivity: ReadonlyMap<string, { updatedAt: number; ended: boolean }>;
  /** The activity currently shown for each bot. */
  byBot: ReadonlyMap<string, string>;
}

export const NOTHING_SEEN: LiveSeen = { byActivity: new Map(), byBot: new Map() };

export interface LiveDecision {
  /** "show": display or update; "ignore": a late or repeated push. */
  action: "show" | "ignore";
  /** Notification ids to remove first: the bot's earlier task that this one replaces. */
  cancel: string[];
  seen: LiveSeen;
}

/**
 * Decides what a push does. An update older than the one already shown is ignored, and so is any
 * running update after the activity ended. A new activity from a bot that had another shown
 * replaces it (one ongoing notification per bot). Pure: returns the new `seen`.
 */
export function decideLive(seen: LiveSeen, push: LivePush): LiveDecision {
  const before = seen.byActivity.get(push.activityId);
  if (before !== undefined && (push.updatedAt < before.updatedAt || (before.ended && !isEnded(push.state)))) {
    return { action: "ignore", cancel: [], seen };
  }
  const ended = isEnded(push.state);
  const byActivity = new Map(seen.byActivity).set(push.activityId, { updatedAt: push.updatedAt, ended });
  const byBot = new Map(seen.byBot);
  const earlier = seen.byBot.get(push.botId);
  const cancel: string[] = [];
  if (earlier !== undefined && earlier !== push.activityId && !seen.byActivity.get(earlier)?.ended) {
    cancel.push(liveNotificationId(earlier));
  }
  if (ended) {
    if (earlier === push.activityId) byBot.delete(push.botId);
  } else {
    byBot.set(push.botId, push.activityId);
  }
  return { action: "show", cancel, seen: { byActivity, byBot } };
}
