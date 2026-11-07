import { describe, expect, test } from "bun:test";
import { AlertValidationError } from "./validate";
import { LIVE_MAX_STEPS, LIVE_STALE_MS, LIVE_STEP_MAX, LIVE_TITLE_MAX, validateLiveCommand } from "./live";

function refused(body: unknown): string {
  try {
    validateLiveCommand(body);
  } catch (error) {
    if (error instanceof AlertValidationError) return error.message;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("validateLiveCommand", () => {
  test("start takes a title, optional steps and an optional link", () => {
    expect(validateLiveCommand({ action: "start", title: "  Fix the build  " })).toEqual({
      action: "start",
      title: "Fix the build",
      steps: null,
      link: null,
    });
    expect(
      validateLiveCommand({ action: "start", title: "Fix", steps: ["Read", "Test"], link: "https://example.com/pr/1" }),
    ).toEqual({ action: "start", title: "Fix", steps: ["Read", "Test"], link: "https://example.com/pr/1" });
  });

  test("step and steps take text, and end defaults to done", () => {
    expect(validateLiveCommand({ action: "step", step: "Running the tests" })).toEqual({
      action: "step",
      step: "Running the tests",
    });
    expect(validateLiveCommand({ action: "steps", steps: ["A", "B"] })).toEqual({ action: "steps", steps: ["A", "B"] });
    expect(validateLiveCommand({ action: "end" })).toEqual({ action: "end", state: "done" });
    expect(validateLiveCommand({ action: "end", state: "failed" })).toEqual({ action: "end", state: "failed" });
  });

  test("refuses a missing or unknown action", () => {
    expect(refused({})).toMatch(/action must be/);
    expect(refused({ action: "pause" })).toMatch(/action must be/);
    expect(refused(["start"])).toMatch(/JSON object/);
  });

  test("checks title and step lengths, lines and counts", () => {
    expect(refused({ action: "start", title: "  " })).toMatch(/title is required/);
    expect(refused({ action: "start", title: "x".repeat(LIVE_TITLE_MAX + 1) })).toMatch(/title is too long/);
    expect(refused({ action: "start", title: "two\nlines" })).toMatch(/one line/);
    expect(refused({ action: "step", step: "x".repeat(LIVE_STEP_MAX + 1) })).toMatch(/step is too long/);
    const tooMany = Array.from({ length: LIVE_MAX_STEPS + 1 }, (_, index) => `s${index}`);
    expect(refused({ action: "steps", steps: tooMany })).toMatch(/at most 12 steps/);
    expect(refused({ action: "steps", steps: [] })).toMatch(/at least one step/);
    expect(refused({ action: "steps", steps: ["A", "A"] })).toMatch(/distinct/);
    expect(refused({ action: "steps", steps: ["A", 3] })).toMatch(/steps\[1\] must be a string/);
  });

  test("checks the link and the end state", () => {
    expect(refused({ action: "start", title: "x", link: "ftp://example.com" })).toMatch(/https:\/\/ or http:\/\//);
    expect(refused({ action: "start", title: "x", link: "https://example.com/a b" })).toMatch(/whitespace/);
    expect(refused({ action: "end", state: "ok" })).toMatch(/state must be done or failed/);
  });

  test("the stale window is 30 minutes", () => {
    expect(LIVE_STALE_MS).toBe(30 * 60 * 1000);
  });
});
