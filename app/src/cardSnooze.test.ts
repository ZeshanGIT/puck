import { describe, expect, test } from "bun:test";
import { requestSnoozeOnOpen, subscribeSnoozeRequests, takeSnoozeOnOpen } from "./cardSnooze";

describe("snooze requested from the compact card", () => {
  test("is taken once, by the alert it names", () => {
    requestSnoozeOnOpen("q_SNOOZE000001");
    expect(takeSnoozeOnOpen("q_OTHER0000001")).toBe(false);
    expect(takeSnoozeOnOpen("q_SNOOZE000001")).toBe(true);
    expect(takeSnoozeOnOpen("q_SNOOZE000001")).toBe(false);
  });

  test("notifies a screen that is already showing the alert", () => {
    let calls = 0;
    const unsubscribe = subscribeSnoozeRequests(() => {
      calls += 1;
    });
    requestSnoozeOnOpen("q_SNOOZE000002");
    expect(calls).toBe(1);
    unsubscribe();
    requestSnoozeOnOpen("q_SNOOZE000003");
    expect(calls).toBe(1);
    takeSnoozeOnOpen("q_SNOOZE000002");
    takeSnoozeOnOpen("q_SNOOZE000003");
  });
});
