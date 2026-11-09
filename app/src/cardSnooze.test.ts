import { describe, expect, test } from "bun:test";
import {
  cardSnoozeFromNative,
  cardSnoozeUntil,
  requestSnoozeOnOpen,
  shouldHandleOpen,
  subscribeSnoozeRequests,
  takeSnoozeOnOpen,
} from "./cardSnooze";

describe("snooze requested from the compact card", () => {
  test("is taken once, by the alert it names", () => {
    requestSnoozeOnOpen("q_SNOOZE000001");
    expect(takeSnoozeOnOpen("q_OTHER0000001")).toBeNull();
    expect(takeSnoozeOnOpen("q_SNOOZE000001")).toEqual({ kind: "choose" });
    expect(takeSnoozeOnOpen("q_SNOOZE000001")).toBeNull();
  });

  test("keeps the length the swipe picked", () => {
    requestSnoozeOnOpen("q_SNOOZE000004", { kind: "timed", minutes: 10 });
    expect(takeSnoozeOnOpen("q_SNOOZE000004")).toEqual({ kind: "timed", minutes: 10 });
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

describe("what the native card sends", () => {
  test("maps minutes, until I'm back and the plain Snooze button", () => {
    expect(cardSnoozeFromNative(5)).toEqual({ kind: "timed", minutes: 5 });
    expect(cardSnoozeFromNative(10)).toEqual({ kind: "timed", minutes: 10 });
    expect(cardSnoozeFromNative(-1)).toEqual({ kind: "timed", minutes: null });
    expect(cardSnoozeFromNative(0)).toEqual({ kind: "choose" });
    expect(cardSnoozeFromNative(undefined)).toEqual({ kind: "choose" });
    expect(cardSnoozeFromNative(Number.NaN)).toEqual({ kind: "choose" });
  });

  test("turns minutes into the until that answers.snooze takes", () => {
    expect(cardSnoozeUntil(5, 1_000)).toBe(1_000 + 300_000);
    expect(cardSnoozeUntil(null, 1_000)).toBeNull();
  });
});

describe("one card gesture arriving by two routes", () => {
  test("is handled once, by nonce", () => {
    expect(shouldHandleOpen(9001)).toBe(true);
    expect(shouldHandleOpen(9001)).toBe(false);
    expect(shouldHandleOpen(9002)).toBe(true);
  });

  test("a request without a nonce is always handled", () => {
    expect(shouldHandleOpen(0)).toBe(true);
    expect(shouldHandleOpen(0)).toBe(true);
  });
});
