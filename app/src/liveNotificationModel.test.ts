import { describe, expect, test } from "bun:test";
import type { LivePush } from "./livePayload";
import {
  closingLine,
  decideLive,
  FINAL_LINE_MS,
  liveNotificationId,
  liveNotificationSpec,
  liveProgress,
  NOTHING_SEEN,
  stepsToGo,
} from "./liveNotificationModel";

function push(over: Partial<LivePush> = {}): LivePush {
  return {
    activityId: "a1",
    botId: "sheldon-11019",
    botName: "Sheldon",
    title: "Fixing the swipe arm bug",
    currentStep: "Running the tests",
    state: "running",
    startedAt: 1000,
    updatedAt: 2000,
    colour: "coral",
    stepIndex: 2,
    stepCount: 5,
    ...over,
  };
}

describe("progress", () => {
  test("steps finished out of all steps; none without a track", () => {
    expect(liveProgress(push())).toEqual({ max: 5, current: 2 });
    expect(liveProgress(push({ stepIndex: 0 }))).toEqual({ max: 5, current: 0 });
    expect(liveProgress(push({ stepIndex: null, stepCount: null }))).toBeNull();
  });

  test("done fills the bar", () => {
    expect(liveProgress(push({ state: "done", stepIndex: 3 }))).toEqual({ max: 5, current: 5 });
  });

  test("steps to go", () => {
    expect(stepsToGo(push())).toBe(2);
    expect(stepsToGo(push({ stepIndex: 4 }))).toBe(0);
    expect(stepsToGo(push({ stepIndex: null, stepCount: null }))).toBeNull();
  });
});

describe("the notification", () => {
  test("a running task is ongoing, with the step, steps to go, a chronometer and a bar", () => {
    const spec = liveNotificationSpec(push());
    expect(spec).toMatchObject({
      id: liveNotificationId("a1"),
      title: "Fixing the swipe arm bug",
      subtitle: "Sheldon",
      body: "Running the tests · 2 to go",
      progress: { max: 5, current: 2 },
      chronometerFrom: 1000,
      ongoing: true,
      timeoutAfter: null,
      colour: "#e24b3a",
    });
  });

  test("the last step says so; a task with no steps has just the step and no bar", () => {
    expect(liveNotificationSpec(push({ stepIndex: 4 })).body).toBe("Running the tests · last step");
    const plain = liveNotificationSpec(push({ stepIndex: null, stepCount: null, colour: null }));
    expect(plain.body).toBe("Running the tests");
    expect(plain.progress).toBeNull();
    expect(plain.colour).toBeNull();
    expect(liveNotificationSpec(push({ currentStep: "", stepIndex: null, stepCount: null })).body).toBe("Working");
  });

  test("an ended task is a brief closing line that clears itself and can be swiped away", () => {
    const done = liveNotificationSpec(push({ state: "done" }));
    expect(done).toMatchObject({ body: "Finished", ongoing: false, timeoutAfter: FINAL_LINE_MS, chronometerFrom: null });
    expect(done.progress).toEqual({ max: 5, current: 5 });
    expect(liveNotificationSpec(push({ state: "failed" })).body).toBe("Didn't finish");
    expect(liveNotificationSpec(push({ state: "failed" })).progress).toBeNull();
    expect(closingLine("stale")).toBe("Stopped updating");
  });
});

describe("which pushes to apply", () => {
  test("a first push shows; an update shows; a repeat of an older one is ignored", () => {
    const first = decideLive(NOTHING_SEEN, push({ updatedAt: 2000 }));
    expect(first.action).toBe("show");
    const second = decideLive(first.seen, push({ updatedAt: 3000 }));
    expect(second.action).toBe("show");
    expect(decideLive(second.seen, push({ updatedAt: 2500 })).action).toBe("ignore");
  });

  test("a running push after the end is ignored, so a late one cannot bring it back", () => {
    const ended = decideLive(NOTHING_SEEN, push({ state: "done", updatedAt: 5000 }));
    expect(ended.action).toBe("show");
    expect(decideLive(ended.seen, push({ state: "running", updatedAt: 6000 })).action).toBe("ignore");
  });

  test("a new task from the same bot replaces the earlier one's notification", () => {
    const a = decideLive(NOTHING_SEEN, push());
    const b = decideLive(a.seen, push({ activityId: "a2", updatedAt: 4000 }));
    expect(b.action).toBe("show");
    expect(b.cancel).toEqual([liveNotificationId("a1")]);
    // Another bot's task is left alone.
    const c = decideLive(b.seen, push({ activityId: "a3", botId: "brow-00007" }));
    expect(c.cancel).toEqual([]);
  });

  test("nothing is cancelled when the earlier task had already ended", () => {
    const a = decideLive(NOTHING_SEEN, push({ state: "done" }));
    expect(decideLive(a.seen, push({ activityId: "a2", updatedAt: 9000 })).cancel).toEqual([]);
  });

  test("the input is not changed", () => {
    decideLive(NOTHING_SEEN, push());
    expect(NOTHING_SEEN.byActivity.size).toBe(0);
  });
});
