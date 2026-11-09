import { describe, expect, test } from "bun:test";
import { checkMachine, describeMachine, runMachine } from "@puck/shared";
import { type TestPageEvent, testPage } from "./testPageMachine";

const alert: TestPageEvent = { type: "alertsChanged", hasAlert: true, loaded: true };
const gone: TestPageEvent = { type: "alertsChanged", hasAlert: false, loaded: true };
const loading: TestPageEvent = { type: "alertsChanged", hasAlert: false, loaded: false };

function last(events: TestPageEvent[]) {
  const states = runMachine(testPage, events);
  return states[states.length - 1] ?? testPage.initial;
}

describe("testPage machine", () => {
  test("passes the totality and purity check", () => {
    expect(checkMachine(testPage)).toEqual([]);
  });

  test("nothing happens before the cleanup query resolves", () => {
    // The pending query is skipped, so it reports no alert and not loaded.
    expect(last([loading, loading])).toEqual(testPage.initial);
    expect(last([{ type: "clearedOldPages" }])).toEqual({ ...testPage.initial, cleared: true });
  });

  test("skip-then-send: a send runs idle, sending, sent without finishing the step", () => {
    const states = runMachine(testPage, [
      { type: "clearedOldPages" },
      loading,
      gone,
      { type: "sendStarted" },
      { type: "sendSucceeded" },
    ]);
    expect(states.map((state) => testPage.label(state))).toEqual(["idle", "idle", "idle", "sending", "sent"]);
    expect(states[4]?.done).toBe(false);
  });

  test("a send failure shows the error and returns to idle", () => {
    const state = last([{ type: "clearedOldPages" }, { type: "sendStarted" }, { type: "sendFailed", message: "offline" }]);
    expect(state.send).toBe("idle");
    expect(state.error).toBe("offline");
  });

  test("a second send clears the error", () => {
    const states = runMachine(testPage, [
      { type: "clearedOldPages" },
      { type: "sendStarted" },
      { type: "sendFailed", message: "offline" },
      { type: "sendStarted" },
    ]);
    expect(states[3]?.error).toBeNull();
    expect(states[3]?.send).toBe("sending");
  });

  test("done latches only after an alert was seen and then leaves", () => {
    const states = runMachine(testPage, [{ type: "clearedOldPages" }, gone, alert, alert, gone, alert, gone]);
    expect(states.map((state) => state.done)).toEqual([false, false, false, false, true, true, true]);
    expect(states.map((state) => state.sawAlert)).toEqual([false, false, true, true, false, true, true]);
  });

  test("an alert leaving while the query is still loading does not finish the step", () => {
    expect(last([{ type: "clearedOldPages" }, alert, loading]).done).toBe(false);
  });

  test("done stays done through later sends and failures", () => {
    const state = last([{ type: "clearedOldPages" }, alert, gone, { type: "sendStarted" }, { type: "sendFailed", message: "x" }]);
    expect(state.done).toBe(true);
  });

  test("known limitation: done latches for any alert, not only the test one", () => {
    // The machine never learns which alert it was; a real alert answered during onboarding finishes the step.
    const state = last([{ type: "clearedOldPages" }, alert, gone]);
    expect(state.send).toBe("idle");
    expect(state.done).toBe(true);
  });

  test("unchanged events return the same state object", () => {
    const [first, second] = runMachine(testPage, [alert, alert]);
    expect(second).toBe(first as object);
  });

  test("describes itself for the docs", () => {
    const rows = describeMachine(testPage);
    expect(rows).toContainEqual({ from: "clearing", event: "clearedOldPages", to: "idle" });
    expect(rows).toContainEqual({ from: "idle", event: "sendStarted", to: "sending" });
    expect(rows).toContainEqual({ from: "alertShown", event: "alertsChanged", to: "done" });
  });
});
