import { describe, expect, test } from "bun:test";
import { checkMachine, describeMachine, runMachine } from "@puck/shared";
import { type PermissionsEvent, type PermissionsState, permissionsCheck } from "./permissionsMachine";

const read = (notification: boolean, fullScreen: boolean, dnd: boolean | null): PermissionsEvent => ({
  type: "read",
  notification,
  fullScreen,
  dnd,
});

function effectsOf(events: PermissionsEvent[]) {
  return runMachine(permissionsCheck, events).map((state: PermissionsState) => state.effects);
}

describe("permissionsCheck machine", () => {
  test("passes the totality and purity check", () => {
    expect(checkMachine(permissionsCheck)).toEqual([]);
  });

  test("the first look only records the current state", () => {
    expect(effectsOf([read(false, false, false)])).toEqual([
      [{ kind: "syncClientFullScreen" }, { kind: "syncDndFlag", value: false }],
    ]);
    const [state] = runMachine(permissionsCheck, [read(true, true, true)]);
    expect(state?.seen).toEqual({ notification: true, fullScreen: true, dnd: true });
    // No toasts on the first look even when everything is already on.
    expect(state?.effects.some((effect) => effect.kind === "toast")).toBe(false);
  });

  test("granting notifications later toasts and syncs the push token", () => {
    expect(effectsOf([read(false, false, false), read(true, false, false)])[1]).toEqual([
      { kind: "toast", text: "Notifications on" },
      { kind: "syncPushToken" },
    ]);
  });

  test("full-screen granted toasts and syncs the flag, and revoking only syncs the flag", () => {
    const all = effectsOf([read(false, false, false), read(false, true, false), read(false, false, false)]);
    expect(all[1]).toEqual([
      { kind: "toast", text: "Full-screen alerts allowed" },
      { kind: "syncFullScreenFlag", value: true },
    ]);
    expect(all[2]).toEqual([{ kind: "syncFullScreenFlag", value: false }]);
  });

  test("no change produces no effects", () => {
    expect(effectsOf([read(true, true, true), read(true, true, true)])[1]).toEqual([]);
  });

  test("revoking notifications is quiet", () => {
    expect(effectsOf([read(true, false, false), read(false, false, false)])[1]).toEqual([]);
  });

  test("effects keep the original order when everything changes at once", () => {
    expect(effectsOf([read(false, false, false), read(true, true, true)])[1]).toEqual([
      { kind: "syncDndFlag", value: true },
      { kind: "toast", text: "Notifications on" },
      { kind: "syncPushToken" },
      { kind: "toast", text: "Full-screen alerts allowed" },
      { kind: "syncFullScreenFlag", value: true },
    ]);
  });

  test("dnd null (no native function) produces no dnd sync", () => {
    const all = effectsOf([read(false, false, null), read(false, false, null), read(false, false, true), read(false, false, null)]);
    expect(all[0]).toEqual([{ kind: "syncClientFullScreen" }]);
    expect(all[1]).toEqual([]);
    expect(all[2]).toEqual([{ kind: "syncDndFlag", value: true }]);
    expect(all[3]).toEqual([]);
  });

  test("a dnd change after the first look syncs the new value", () => {
    expect(effectsOf([read(false, false, false), read(false, false, true)])[1]).toEqual([{ kind: "syncDndFlag", value: true }]);
  });

  test("dnd launched then resume toasts and marks it asked, unless access is known to be off", () => {
    const allowed = runMachine(permissionsCheck, [{ type: "leftForDndSettings" }, { type: "appResumed", dnd: true }]);
    expect(allowed[0]?.effects).toEqual([]);
    expect(allowed[1]?.effects).toEqual([{ kind: "toast", text: "Do Not Disturb access allowed" }]);
    expect(allowed[1]?.dndAsked).toBe(true);
    expect(allowed[1]?.dndLaunched).toBe(false);

    const unknown = runMachine(permissionsCheck, [{ type: "leftForDndSettings" }, { type: "appResumed", dnd: null }]);
    expect(unknown[1]?.effects).toEqual([{ kind: "toast", text: "Do Not Disturb access allowed" }]);
    expect(unknown[1]?.dndAsked).toBe(true);

    const off = runMachine(permissionsCheck, [{ type: "leftForDndSettings" }, { type: "appResumed", dnd: false }]);
    expect(off[1]?.effects).toEqual([]);
    expect(off[1]?.dndAsked).toBe(true);
  });

  test("resuming without having left for dnd settings does nothing, and only once after leaving", () => {
    const states = runMachine(permissionsCheck, [
      { type: "appResumed", dnd: true },
      { type: "leftForDndSettings" },
      { type: "appResumed", dnd: true },
      { type: "appResumed", dnd: true },
    ]);
    expect(states[0]).toEqual(permissionsCheck.initial);
    expect(states[2]?.effects).toHaveLength(1);
    expect(states[3]?.effects).toEqual([]);
    expect(states[3]?.dndAsked).toBe(true);
  });

  test("a failed launch clears the latch, so the next resume stays quiet", () => {
    const states = runMachine(permissionsCheck, [
      { type: "leftForDndSettings" },
      { type: "dndLaunchFailed" },
      { type: "appResumed", dnd: true },
    ]);
    expect(states[2]?.effects).toEqual([]);
    expect(states[2]?.dndAsked).toBe(false);
  });

  test("a read does not disturb the dnd latch or the asked flag", () => {
    const states = runMachine(permissionsCheck, [{ type: "leftForDndSettings" }, read(false, false, false)]);
    expect(states[1]?.dndLaunched).toBe(true);
  });

  test("describes itself for the docs", () => {
    const rows = describeMachine(permissionsCheck);
    expect(rows).toContainEqual({ from: "unseen", event: "read", to: "watching" });
    expect(rows).toContainEqual({ from: "watching", event: "leftForDndSettings", to: "awaitingDnd" });
    expect(rows).toContainEqual({ from: "awaitingDnd", event: "appResumed", to: "watching" });
  });
});
