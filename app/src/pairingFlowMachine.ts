/**
 * The pairing flow, J2, in one place: B3 (type a code), B4 (approve a request), B5 (meet the bot).
 *
 *   code     --codeTyped-----------------> code (waiting: `typed` holds the code until the list loads)
 *   code     --codeLookedUp(match)-------> approve (showCode false: he typed the code himself)
 *   code     --codeLookedUp(no match)----> code (busy: the code is approved straight away)
 *   code     --approveSucceeded----------> meet    (the straight-away approval)
 *   approve  --approveStarted/rejectStarted--> approve (busy)
 *   approve  --approveSucceeded----------> meet
 *   approve  --rejectSucceeded-----------> approve (idle; the screen closes the flow)
 *   code | approve --failed--------------> same step, `error` set, `busy` cleared
 *   approve (typed) --back---------------> code     (Back from a typed code returns to the keypad)
 *
 * The screen does the work the state asks for and reports back with an event: looking the typed
 * code up in the request list (`typedCodeToLookUp`), calling approve or reject, clearing the
 * notification, closing (`backAction`). Nothing here touches React, the network or the clock.
 *
 * The one thing kept outside the state is the request B4 keeps showing while it is approved after
 * it has left the list. It is a request object read from the live list during render, so it stays
 * a ref in `PairingHost` rather than being copied into the state on every list change.
 */
import { defineMachine } from "@puck/shared";
import type { BlobBot } from "./ui/blobShapes";

/** Which screen the flow is on. */
export type PairingStep =
  | { kind: "code" }
  | { kind: "approve"; botId: string; showCode: boolean }
  | { kind: "meet"; bot: BlobBot };

/** Where the flow starts: the same shapes as `PairingStart` in `PairingHost`. */
export type PairingFlowStart =
  | { kind: "code" }
  | { kind: "approve"; botId: string }
  | { kind: "meet"; bot: BlobBot };

export interface PairingFlowState {
  step: PairingStep;
  /** The line under the keypad or on B4, or null. */
  error: string | null;
  /** An approve or reject is in flight. Back is blocked meanwhile. */
  busy: boolean;
  /** A typed code waiting for the request list to load, so a request is never skipped by being early. Only on `code`. */
  typed: string | null;
}

export type PairingFlowEvent =
  /** The sixth digit was entered. */
  | { type: "codeTyped"; code: string }
  /** The error line was cleared by editing the code. */
  | { type: "codeEdited" }
  /** The typed code was looked up in the request list: `botId` of the match, or null for none. */
  | { type: "codeLookedUp"; botId: string | null }
  /** Approve was pressed on B4. */
  | { type: "approveStarted" }
  /** Reject was pressed on B4. */
  | { type: "rejectStarted" }
  /** An approve (from B4 or straight from a typed code) went through. */
  | { type: "approveSucceeded"; bot: BlobBot }
  /** A reject went through. */
  | { type: "rejectSucceeded" }
  /** An approve or reject failed; `message` is the text to show. */
  | { type: "failed"; message: string }
  /** Back was pressed (the screen's Back control or Android's back gesture). */
  | { type: "back" };

/** What Back does now: nothing while busy, the keypad from a typed approve, otherwise close the flow. */
export type PairingBackAction = "ignore" | "keypad" | "close";

export function initialPairingFlow(start: PairingFlowStart): PairingFlowState {
  const step: PairingStep = start.kind === "approve" ? { kind: "approve", botId: start.botId, showCode: true } : start;
  return { step, error: null, busy: false, typed: null };
}

/** What Back should do in this state. The screen calls `onClose` itself for "close". */
export function backAction(state: PairingFlowState): PairingBackAction {
  if (state.busy) return "ignore";
  if (state.step.kind === "approve" && !state.step.showCode) return "keypad";
  return "close";
}

/** The typed code to look up now (once the request list is known), or null when there is none. */
export function typedCodeToLookUp(state: PairingFlowState): string | null {
  return state.step.kind === "code" ? state.typed : null;
}

/** True while the keypad shows as busy: an approval is in flight, or a typed code waits for the list. */
export function keypadBusy(state: PairingFlowState): boolean {
  return state.busy || state.typed !== null;
}

/** Pure and total. An event that makes no sense in a state returns the same state. */
export function pairingFlowTransition(state: PairingFlowState, event: PairingFlowEvent): PairingFlowState {
  const { step } = state;
  switch (event.type) {
    case "codeTyped":
      return step.kind === "code" ? { ...state, error: null, typed: event.code } : state;
    case "codeEdited":
      return state.error === null ? state : { ...state, error: null };
    case "codeLookedUp":
      if (step.kind !== "code" || state.typed === null) return state;
      if (event.botId !== null) {
        return { ...state, step: { kind: "approve", botId: event.botId, showCode: false }, typed: null };
      }
      return { ...state, typed: null, busy: true };
    case "approveStarted":
    case "rejectStarted":
      return step.kind === "approve" ? { ...state, error: null, busy: true } : state;
    case "approveSucceeded":
      return step.kind !== "meet" && state.busy
        ? { step: { kind: "meet", bot: event.bot }, error: null, busy: false, typed: null }
        : state;
    case "rejectSucceeded":
      return step.kind === "approve" && state.busy ? { ...state, busy: false } : state;
    case "failed":
      return step.kind !== "meet" && state.busy ? { ...state, error: event.message, busy: false } : state;
    case "back":
      return backAction(state) === "keypad" ? { step: { kind: "code" }, error: null, busy: false, typed: null } : state;
  }
}

function phase(state: PairingFlowState): string {
  switch (state.step.kind) {
    case "code":
      return state.typed !== null ? "code-waiting" : state.busy ? "code-approving" : "code";
    case "approve":
      return state.busy ? "approving" : "approve";
    case "meet":
      return "meet";
  }
}

const SAMPLE_BOT: BlobBot = { name: "Sheldon", colour: "coral", shape: "squircle", tilt: -7 };

export const pairingFlow = defineMachine<PairingFlowState, PairingFlowEvent>({
  name: "pairing-flow",
  summary:
    "J2 pairing screens: B3 keypad (a typed code may wait for the request list), B4 approve or reject, B5 meet. Holds the screen, the error line and whether an approve or reject is in flight.",
  usedBy: ["app/src/screens/PairingHost.tsx"],
  initial: initialPairingFlow({ kind: "code" }),
  transition: pairingFlowTransition,
  label: phase,
  invariant: (state) => {
    if (state.busy && state.step.kind === "meet") return "busy while on meet";
    if (state.error !== null && state.step.kind === "meet") return "error shown on meet";
    if (state.typed !== null && state.step.kind !== "code") return "typed code set while not on the keypad";
    return null;
  },
  samples: {
    states: [
      { step: { kind: "code" }, error: null, busy: false, typed: null },
      { step: { kind: "code" }, error: "That code has expired.", busy: false, typed: null },
      { step: { kind: "code" }, error: null, busy: false, typed: "482913" },
      { step: { kind: "code" }, error: null, busy: true, typed: null },
      { step: { kind: "approve", botId: "sheldon-11019", showCode: true }, error: null, busy: false, typed: null },
      { step: { kind: "approve", botId: "sheldon-11019", showCode: false }, error: null, busy: false, typed: null },
      { step: { kind: "approve", botId: "sheldon-11019", showCode: false }, error: null, busy: true, typed: null },
      { step: { kind: "meet", bot: SAMPLE_BOT }, error: null, busy: false, typed: null },
    ],
    events: [
      { type: "codeTyped", code: "482913" },
      { type: "codeEdited" },
      { type: "codeLookedUp", botId: "sheldon-11019" },
      { type: "codeLookedUp", botId: null },
      { type: "approveStarted" },
      { type: "rejectStarted" },
      { type: "approveSucceeded", bot: SAMPLE_BOT },
      { type: "rejectSucceeded" },
      { type: "failed", message: "That code has expired." },
      { type: "back" },
    ],
  },
});
