import { describe, expect, test } from "bun:test";
import { alertLifecycle, decideAlert, initialAlertStatus, isFinalAlertStatus, isWaitingAlertStatus } from "./alertLifecycle";
import { checkMachine, describeMachine, mermaidFor, runMachine } from "./machine";
import { ALERT_STATUSES } from "./model";

describe("alertLifecycle machine", () => {
  test("passes the totality and purity check", () => {
    expect(checkMachine(alertLifecycle)).toEqual([]);
  });

  test("covers every stored status", () => {
    expect([...alertLifecycle.samples.states].sort()).toEqual([...ALERT_STATUSES].sort());
  });

  test("a snoozed alert comes back by timer, wake or a newer snooze, and can still be answered", () => {
    const ev = alertLifecycle.samples.events;
    expect(runMachine(alertLifecycle, [{ type: "snooze" }, { type: "snoozeElapsed", current: true }])).toEqual([
      "snoozed",
      "pending",
    ]);
    expect(runMachine(alertLifecycle, [{ type: "snooze" }, { type: "wake", untimed: true }])).toEqual(["snoozed", "pending"]);
    expect(runMachine(alertLifecycle, [{ type: "snooze" }, { type: "snooze" }])).toEqual(["snoozed", "snoozed"]);
    expect(runMachine(alertLifecycle, [{ type: "snooze" }, { type: "answer" }])).toEqual(["snoozed", "answered"]);
    expect(ev.length).toBeGreaterThan(0);
  });

  test("answered and cancelled never change", () => {
    for (const status of ["answered", "cancelled"] as const) {
      for (const event of alertLifecycle.samples.events) {
        expect(decideAlert(status, event).status).toBe(status);
        expect(decideAlert(status, event).changed).toBe(false);
      }
    }
  });

  test("a stale snooze job does nothing", () => {
    expect(decideAlert("snoozed", { type: "snoozeElapsed", current: false }).changed).toBe(false);
    expect(decideAlert("pending", { type: "snoozeElapsed", current: true }).changed).toBe(false);
  });

  test("a wake leaves timed snoozes and other statuses alone", () => {
    expect(decideAlert("snoozed", { type: "wake", untimed: false }).changed).toBe(false);
    expect(decideAlert("pending", { type: "wake", untimed: true }).changed).toBe(false);
  });

  test("keeps the error text the mutations always threw", () => {
    expect(decideAlert("answered", { type: "answer" }).rejection).toBe("alert is already answered");
    expect(decideAlert("cancelled", { type: "answer" }).rejection).toBe("alert is cancelled");
    expect(decideAlert("answered", { type: "snooze" }).rejection).toBe("alert is already answered");
    expect(decideAlert("cancelled", { type: "snooze" }).rejection).toBe("alert is cancelled");
    expect(decideAlert("scheduled", { type: "snooze" }).rejection).toBe("alert is not pending");
    expect(decideAlert("answered", { type: "cancel" }).rejection).toBe("alert is already answered");
    expect(decideAlert("cancelled", { type: "cancel" }).rejection).toBeNull();
  });

  test("answer is still allowed on a scheduled alert (unchanged behaviour)", () => {
    expect(decideAlert("scheduled", { type: "answer" })).toEqual({ status: "answered", changed: true, rejection: null });
  });

  test("release moves only a due scheduled alert", () => {
    expect(decideAlert("scheduled", { type: "release", due: true }).status).toBe("pending");
    expect(decideAlert("scheduled", { type: "release", due: false }).status).toBe("scheduled");
    expect(decideAlert("cancelled", { type: "release", due: true }).status).toBe("cancelled");
  });

  test("initial status follows the schedule", () => {
    expect(initialAlertStatus(null, 10)).toBe("pending");
    expect(initialAlertStatus(10, 10)).toBe("pending");
    expect(initialAlertStatus(11, 10)).toBe("scheduled");
  });

  test("final and waiting helpers", () => {
    expect(ALERT_STATUSES.filter(isFinalAlertStatus)).toEqual(["answered", "cancelled"]);
    expect(ALERT_STATUSES.filter(isWaitingAlertStatus)).toEqual(["pending", "snoozed"]);
  });

  test("describes itself for the docs", () => {
    const rows = describeMachine(alertLifecycle);
    expect(rows).toContainEqual({ from: "pending", event: "snooze", to: "snoozed" });
    expect(mermaidFor(alertLifecycle)).toContain("pending --> snoozed: snooze");
  });
});
