import { describe, expect, test } from "bun:test";
import { AlertValidationError, LIVE_MAX_STEPS, LIVE_LOG_MAX, LIVE_STALE_MS } from "@puck/shared";
import { applyStep, applySteps, effectiveState, isStale, startTrack } from "../convex/lib/liveRules";

describe("startTrack", () => {
  test("with steps, the first one is current; without, there is no current text yet", () => {
    expect(startTrack(["A", "B", "C"])).toEqual({ steps: ["A", "B", "C"], stepIndex: 0, currentStep: "A", log: [] });
    expect(startTrack(null)).toEqual({ steps: null, stepIndex: null, currentStep: "", log: [] });
  });
});

describe("applyStep", () => {
  test("moves to a step already on the list, without changing the list", () => {
    const track = applyStep(startTrack(["A", "B", "C"]), "C");
    expect(track).toMatchObject({ steps: ["A", "B", "C"], stepIndex: 2, currentStep: "C" });
  });

  test("adds a new step midway, right after the current one", () => {
    const track = applyStep(startTrack(["A", "B", "C"]), "X");
    expect(track).toMatchObject({ steps: ["A", "X", "B", "C"], stepIndex: 1, currentStep: "X" });
  });

  test("a new step after the last one is appended", () => {
    const track = applyStep(applyStep(startTrack(["A", "B"]), "B"), "Z");
    expect(track).toMatchObject({ steps: ["A", "B", "Z"], stepIndex: 2, currentStep: "Z" });
  });

  test("a new step with no list starts one from the current position", () => {
    const track = applyStep({ steps: null, stepIndex: null, currentStep: "", log: [] }, "First");
    expect(track).toMatchObject({ currentStep: "First", log: [] });
    expect(track.steps).toBeNull();
  });

  test("without steps, the previous text goes to the log, and the log is capped", () => {
    let track = startTrack(null);
    for (let index = 0; index < LIVE_LOG_MAX + 3; index++) track = applyStep(track, `step ${index}`);
    expect(track.currentStep).toBe(`step ${LIVE_LOG_MAX + 2}`);
    expect(track.log).toHaveLength(LIVE_LOG_MAX);
    expect(track.log[track.log.length - 1]).toBe(`step ${LIVE_LOG_MAX + 1}`);
    expect(applyStep(track, track.currentStep)).toBe(track);
  });

  test("refuses a new step once the list is full", () => {
    const full = Array.from({ length: LIVE_MAX_STEPS }, (_, index) => `s${index}`);
    expect(() => applyStep(startTrack(full), "one more")).toThrow(AlertValidationError);
    expect(applyStep(startTrack(full), "s3").stepIndex).toBe(3);
  });
});

describe("applySteps", () => {
  test("keeps the current step on the new list", () => {
    const track = applySteps(applyStep(startTrack(["A", "B", "C"]), "B"), ["A", "X", "B", "C"]);
    expect(track).toMatchObject({ steps: ["A", "X", "B", "C"], stepIndex: 2, currentStep: "B" });
  });

  test("starts at the first step when the current one was dropped", () => {
    const track = applySteps(applyStep(startTrack(["A", "B"]), "B"), ["P", "Q"]);
    expect(track).toMatchObject({ steps: ["P", "Q"], stepIndex: 0, currentStep: "P" });
  });
});

describe("stale check", () => {
  const T = 1_000_000;

  test("an activity with no update for 30 minutes is stale, and not before", () => {
    expect(isStale(T, T + LIVE_STALE_MS - 1)).toBe(false);
    expect(isStale(T, T + LIVE_STALE_MS)).toBe(true);
  });

  test("a running activity past the window shows as stale; an ended one keeps its state", () => {
    expect(effectiveState({ state: "running", updatedAt: T }, T + LIVE_STALE_MS)).toBe("stale");
    expect(effectiveState({ state: "running", updatedAt: T }, T + 1)).toBe("running");
    expect(effectiveState({ state: "done", updatedAt: T }, T + LIVE_STALE_MS * 2)).toBe("done");
  });
});
