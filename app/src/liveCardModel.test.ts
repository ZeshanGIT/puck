import { describe, expect, test } from "bun:test";
import {
  departedActivities,
  doneStops,
  elapsedText,
  endedState,
  hasTrack,
  liveLook,
  logLines,
  statusText,
  stepSummary,
  stopFractions,
  trackFraction,
  type LiveActivity,
} from "./liveCardModel";

const MIN = 60_000;
const NOW = 10 * 60 * MIN;

function activity(over: Partial<LiveActivity> = {}): LiveActivity {
  return {
    activityId: "a1",
    botId: "sheldon-11019",
    botName: "Sheldon",
    colour: "coral",
    title: "Fixing the swipe arm bug",
    steps: ["Reading the issue", "Writing the fix", "Running the tests", "Building the APK", "Opening a pull request"],
    stepIndex: 2,
    currentStep: "Running the tests",
    log: [],
    state: "running",
    link: null,
    startedAt: NOW - 5 * MIN,
    updatedAt: NOW,
    ...over,
  };
}

describe("the track", () => {
  test("stops are spread evenly, a single stop sits at the start", () => {
    expect(stopFractions(5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(stopFractions(1)).toEqual([0]);
    expect(stopFractions(0)).toEqual([]);
  });

  test("the blob rides to the current stop, and to the end once done", () => {
    const a = activity() as LiveActivity & { steps: string[]; stepIndex: number };
    expect(trackFraction(a)).toBe(0.5);
    expect(trackFraction({ ...a, stepIndex: 0 })).toBe(0);
    expect(trackFraction({ ...a, state: "done" })).toBe(1);
    expect(trackFraction({ ...a, steps: ["only"], stepIndex: 0 })).toBe(0);
  });

  test("a step added midway re-spaces the stops and the blob's place follows", () => {
    const a = activity() as LiveActivity & { steps: string[]; stepIndex: number };
    const added = { ...a, steps: [...a.steps.slice(0, 3), "Fixing a failing test", ...a.steps.slice(3)], stepIndex: 3 };
    expect(stopFractions(added.steps.length)[3]).toBeCloseTo(0.6);
    expect(trackFraction(added)).toBeCloseTo(0.6);
  });

  test("stops before the current one are filled; all when done", () => {
    const a = activity() as LiveActivity & { steps: string[]; stepIndex: number };
    expect(doneStops(a)).toBe(2);
    expect(doneStops({ ...a, state: "done" })).toBe(5);
  });

  test("an index past the end is held to the last step", () => {
    const a = activity({ stepIndex: 9 }) as LiveActivity & { steps: string[]; stepIndex: number };
    expect(trackFraction(a)).toBe(1);
    expect(stepSummary(a)).toEqual({ step: "Opening a pull request", toGo: "last step" });
  });

  test("has a track only with steps and a place on them", () => {
    expect(hasTrack(activity())).toBe(true);
    expect(hasTrack(activity({ steps: null, stepIndex: null }))).toBe(false);
    expect(hasTrack(activity({ steps: [], stepIndex: 0 }))).toBe(false);
  });
});

describe("words", () => {
  test("the step and how many are to go", () => {
    const a = activity() as LiveActivity & { steps: string[]; stepIndex: number };
    expect(stepSummary(a)).toEqual({ step: "Running the tests", toGo: "2 to go" });
    expect(stepSummary({ ...a, state: "done" })).toEqual({ step: "All steps done", toGo: null });
  });

  test("elapsed time and status", () => {
    expect(elapsedText(NOW - 20_000, NOW)).toBe("just started");
    expect(elapsedText(NOW - 5 * MIN, NOW)).toBe("5 min");
    expect(elapsedText(NOW - 80 * MIN, NOW)).toBe("1 h 20 min");
    expect(elapsedText(NOW - 120 * MIN, NOW)).toBe("2 h");
    expect(statusText(activity(), NOW)).toBe("Working · 5 min");
    expect(statusText(activity({ startedAt: NOW - 1000 }), NOW)).toBe("Working · just started");
    expect(statusText(activity({ state: "done" }), NOW)).toBe("Finished · 5 min");
    expect(statusText(activity({ state: "failed" }), NOW)).toBe("Didn't finish");
    expect(statusText(activity({ state: "stale" }), NOW)).toBe("Stopped updating");
  });
});

describe("the log", () => {
  test("the last two finished steps and the current one", () => {
    expect(logLines(activity({ steps: null, stepIndex: null, log: ["a", "b", "c"], currentStep: "d", state: "running" }))).toEqual({
      finished: ["b", "c"],
      current: "d",
    });
  });

  test("with nothing current the newest finished step stands in; nothing at all is empty", () => {
    expect(logLines({ log: ["a", "b", "c"], currentStep: "", state: "done" })).toEqual({ finished: ["a", "b"], current: "c" });
    expect(logLines({ log: [], currentStep: "", state: "running" })).toEqual({ finished: [], current: "" });
  });
});

describe("departed activities", () => {
  const a = activity();
  const b = activity({ activityId: "a2", botId: "brow-00007", botName: "Brow" });

  test("the ones that left the running list", () => {
    expect(departedActivities([a, b], [b]).map((x) => x.activityId)).toEqual(["a1"]);
    expect(departedActivities([a], [a, b])).toEqual([]);
    expect(departedActivities([], [a])).toEqual([]);
  });

  test("how one ended comes from its bot's current activity", () => {
    expect(endedState(a, activity({ state: "done" }))).toBe("done");
    expect(endedState(a, activity({ state: "failed" }))).toBe("failed");
    expect(endedState(a, activity({ state: "stale" }))).toBe("stale");
  });

  test("nothing to show while unknown, replaced by a newer task, or still running", () => {
    expect(endedState(a, undefined)).toBeNull();
    expect(endedState(a, null)).toBeNull();
    expect(endedState(a, activity({ activityId: "a9", state: "done" }))).toBeNull();
    expect(endedState(a, activity({ state: "running" }))).toBeNull();
  });
});

describe("look", () => {
  test("the bot's own colour, else a derived one", () => {
    expect(liveLook(activity({ colour: "teal" })).colour).toBe("teal");
    expect(liveLook(activity({ colour: null })).colour).toBeTruthy();
  });
});
