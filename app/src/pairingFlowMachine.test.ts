import { describe, expect, test } from "bun:test";
import { checkMachine, describeMachine, runMachine } from "@puck/shared";
import {
  backAction,
  initialPairingFlow,
  keypadBusy,
  pairingFlow,
  pairingFlowTransition,
  typedCodeToLookUp,
  type PairingFlowEvent,
  type PairingFlowState,
} from "./pairingFlowMachine";
import type { BlobBot } from "./ui/blobShapes";

const BOT: BlobBot = { name: "Sheldon", colour: "coral", shape: "squircle", tilt: -7 };

function run(events: PairingFlowEvent[], from: PairingFlowState = initialPairingFlow({ kind: "code" })): PairingFlowState {
  return runMachine(pairingFlow, events, from).at(-1) ?? from;
}

describe("pairingFlow machine", () => {
  test("passes the totality and purity check", () => {
    expect(checkMachine(pairingFlow)).toEqual([]);
  });

  test("samples cover every event type and every control phase", () => {
    const types = new Set(pairingFlow.samples.events.map((event) => event.type));
    expect([...types].sort()).toEqual(
      ["approveStarted", "approveSucceeded", "back", "codeEdited", "codeLookedUp", "codeTyped", "failed", "rejectStarted", "rejectSucceeded"],
    );
    const labels = new Set(pairingFlow.samples.states.map(pairingFlow.label));
    expect([...labels].sort()).toEqual(["approve", "approving", "code", "code-approving", "code-waiting", "meet"]);
  });

  test("starts where it is told to", () => {
    expect(initialPairingFlow({ kind: "code" }).step).toEqual({ kind: "code" });
    expect(initialPairingFlow({ kind: "approve", botId: "a-11111" }).step).toEqual({
      kind: "approve",
      botId: "a-11111",
      showCode: true,
    });
    expect(initialPairingFlow({ kind: "meet", bot: BOT }).step).toEqual({ kind: "meet", bot: BOT });
  });

  test("a typed code that matches an open request goes to approve without the code", () => {
    const states = runMachine(pairingFlow, [
      { type: "codeTyped", code: "482913" },
      { type: "codeLookedUp", botId: "sheldon-11019" },
    ]);
    expect(states[0]).toMatchObject({ typed: "482913", busy: false });
    expect(states[1]).toEqual({
      step: { kind: "approve", botId: "sheldon-11019", showCode: false },
      error: null,
      busy: false,
      typed: null,
    });
  });

  test("a typed code with no match is approved straight away, then meets the bot", () => {
    const states = runMachine(pairingFlow, [
      { type: "codeTyped", code: "482913" },
      { type: "codeLookedUp", botId: null },
      { type: "approveSucceeded", bot: BOT },
    ]);
    expect(states[1]).toEqual({ step: { kind: "code" }, error: null, busy: true, typed: null });
    expect(states[2]).toEqual({ step: { kind: "meet", bot: BOT }, error: null, busy: false, typed: null });
  });

  test("a typed code waits while the requests are unknown and is never skipped", () => {
    const waiting = run([{ type: "codeTyped", code: "482913" }]);
    expect(typedCodeToLookUp(waiting)).toBe("482913");
    expect(keypadBusy(waiting)).toBe(true);
    expect(pairingFlow.label(waiting)).toBe("code-waiting");
    // Nothing but the lookup (or Back from approve) takes the code away.
    expect(pairingFlowTransition(waiting, { type: "codeEdited" }).typed).toBe("482913");
    expect(pairingFlowTransition(waiting, { type: "back" })).toBe(waiting);
    const looked = pairingFlowTransition(waiting, { type: "codeLookedUp", botId: null });
    expect(typedCodeToLookUp(looked)).toBeNull();
  });

  test("a lookup with nothing typed does nothing", () => {
    const idle = initialPairingFlow({ kind: "code" });
    expect(pairingFlowTransition(idle, { type: "codeLookedUp", botId: "x-11111" })).toBe(idle);
    expect(pairingFlowTransition(idle, { type: "codeLookedUp", botId: null })).toBe(idle);
  });

  test("a wrong code sets the error and clears busy", () => {
    const state = run([
      { type: "codeTyped", code: "000000" },
      { type: "codeLookedUp", botId: null },
      { type: "failed", message: "That code has expired." },
    ]);
    expect(state).toEqual({ step: { kind: "code" }, error: "That code has expired.", busy: false, typed: null });
    expect(keypadBusy(state)).toBe(false);
  });

  test("typing again clears the old error", () => {
    const failed = run([
      { type: "codeTyped", code: "000000" },
      { type: "codeLookedUp", botId: null },
      { type: "failed", message: "nope" },
    ]);
    expect(pairingFlowTransition(failed, { type: "codeTyped", code: "111111" })).toMatchObject({
      error: null,
      typed: "111111",
    });
  });

  test("editing the code clears the error text, and does nothing when there is none", () => {
    const withError: PairingFlowState = { step: { kind: "code" }, error: "nope", busy: false, typed: null };
    expect(pairingFlowTransition(withError, { type: "codeEdited" })).toEqual({ ...withError, error: null });
    const clean = initialPairingFlow({ kind: "code" });
    expect(pairingFlowTransition(clean, { type: "codeEdited" })).toBe(clean);
  });

  test("back is ignored while busy", () => {
    const busyApprove: PairingFlowState = {
      step: { kind: "approve", botId: "sheldon-11019", showCode: false },
      error: null,
      busy: true,
      typed: null,
    };
    expect(backAction(busyApprove)).toBe("ignore");
    expect(pairingFlowTransition(busyApprove, { type: "back" })).toBe(busyApprove);
    const busyCode: PairingFlowState = { step: { kind: "code" }, error: null, busy: true, typed: null };
    expect(backAction(busyCode)).toBe("ignore");
  });

  test("back from a typed approve returns to the keypad with the error cleared", () => {
    const state = run([
      { type: "codeTyped", code: "482913" },
      { type: "codeLookedUp", botId: "sheldon-11019" },
      { type: "approveStarted" },
      { type: "failed", message: "That code has expired." },
    ]);
    expect(state.error).toBe("That code has expired.");
    expect(backAction(state)).toBe("keypad");
    expect(pairingFlowTransition(state, { type: "back" })).toEqual({
      step: { kind: "code" },
      error: null,
      busy: false,
      typed: null,
    });
  });

  test("back from a request opened by a tap, or from the keypad, closes the flow", () => {
    const opened = initialPairingFlow({ kind: "approve", botId: "sheldon-11019" });
    expect(backAction(opened)).toBe("close");
    expect(pairingFlowTransition(opened, { type: "back" })).toBe(opened);
    expect(backAction(initialPairingFlow({ kind: "code" }))).toBe("close");
    expect(backAction(initialPairingFlow({ kind: "meet", bot: BOT }))).toBe("close");
  });

  test("approve from B4 goes to meet, busy while it runs", () => {
    const states = runMachine(pairingFlow, [{ type: "approveStarted" }, { type: "approveSucceeded", bot: BOT }], initialPairingFlow({ kind: "approve", botId: "sheldon-11019" }));
    expect(states[0]).toMatchObject({ busy: true, error: null });
    expect(pairingFlow.label(states[0]!)).toBe("approving");
    expect(states[1]).toEqual({ step: { kind: "meet", bot: BOT }, error: null, busy: false, typed: null });
  });

  test("a failed approve on B4 shows the error and lets him try again", () => {
    const opened = initialPairingFlow({ kind: "approve", botId: "sheldon-11019" });
    const failed = run([{ type: "approveStarted" }, { type: "failed", message: "boom" }], opened);
    expect(failed).toEqual({ ...opened, error: "boom" });
    expect(pairingFlowTransition(failed, { type: "approveStarted" })).toMatchObject({ error: null, busy: true });
  });

  test("reject finishes with the same screen, ready for the host to close", () => {
    const opened = initialPairingFlow({ kind: "approve", botId: "sheldon-11019" });
    const states = runMachine(pairingFlow, [{ type: "rejectStarted" }, { type: "rejectSucceeded" }], opened);
    expect(states[0]).toMatchObject({ busy: true });
    expect(states[1]).toEqual(opened);
  });

  test("an event that does not apply to a state returns the same state", () => {
    const code = initialPairingFlow({ kind: "code" });
    const approve = initialPairingFlow({ kind: "approve", botId: "sheldon-11019" });
    const meet = initialPairingFlow({ kind: "meet", bot: BOT });
    expect(pairingFlowTransition(code, { type: "approveStarted" })).toBe(code);
    expect(pairingFlowTransition(code, { type: "rejectStarted" })).toBe(code);
    expect(pairingFlowTransition(code, { type: "approveSucceeded", bot: BOT })).toBe(code);
    expect(pairingFlowTransition(code, { type: "rejectSucceeded" })).toBe(code);
    expect(pairingFlowTransition(code, { type: "failed", message: "x" })).toBe(code);
    expect(pairingFlowTransition(approve, { type: "codeTyped", code: "482913" })).toBe(approve);
    expect(pairingFlowTransition(approve, { type: "codeLookedUp", botId: null })).toBe(approve);
    expect(pairingFlowTransition(approve, { type: "rejectSucceeded" })).toBe(approve);
    expect(pairingFlowTransition(meet, { type: "approveStarted" })).toBe(meet);
    expect(pairingFlowTransition(meet, { type: "codeTyped", code: "482913" })).toBe(meet);
    expect(pairingFlowTransition(meet, { type: "approveSucceeded", bot: BOT })).toBe(meet);
    expect(pairingFlowTransition(meet, { type: "failed", message: "x" })).toBe(meet);
    expect(pairingFlowTransition(meet, { type: "back" })).toBe(meet);
  });

  test("the invariant rejects impossible combinations", () => {
    const meet = { kind: "meet", bot: BOT } as const;
    expect(pairingFlow.invariant?.({ step: meet, error: null, busy: true, typed: null })).toContain("busy");
    expect(pairingFlow.invariant?.({ step: meet, error: "x", busy: false, typed: null })).toContain("error");
    expect(
      pairingFlow.invariant?.({ step: { kind: "approve", botId: "a-11111", showCode: true }, error: null, busy: false, typed: "123456" }),
    ).toContain("typed");
    expect(pairingFlow.invariant?.(initialPairingFlow({ kind: "code" }))).toBeNull();
  });

  test("describes itself for the docs", () => {
    const rows = describeMachine(pairingFlow);
    expect(rows).toContainEqual({ from: "code-waiting", event: "codeLookedUp", to: "approve" });
    expect(rows).toContainEqual({ from: "code-approving", event: "approveSucceeded", to: "meet" });
    expect(rows).toContainEqual({ from: "approving", event: "failed", to: "approve" });
  });
});
