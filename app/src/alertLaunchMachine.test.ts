import { describe, expect, test } from "bun:test";
import { checkMachine, runMachine } from "@puck/shared";
import {
  alertLaunch,
  alertLaunchTransition,
  initialAlertLaunch,
  launchIdOf,
  type AlertLaunchEvent,
  type AlertLaunchState,
} from "./alertLaunchMachine";

const seen = (over: Partial<Extract<AlertLaunchEvent, { type: "observed" }>>): AlertLaunchEvent => ({
  type: "observed",
  loaded: true,
  inPending: true,
  inLive: true,
  onDeck: false,
  ...over,
});

function last(events: AlertLaunchEvent[], from: AlertLaunchState = initialAlertLaunch): AlertLaunchState {
  return runMachine(alertLaunch, events, from).at(-1) ?? from;
}

describe("alertLaunch machine", () => {
  test("passes the totality and purity check", () => {
    expect(checkMachine(alertLaunch)).toEqual([]);
  });

  test("a notification tap is preferred while it loads and shows", () => {
    expect(launchIdOf(last([{ type: "opened", id: "q_A" }]))).toBe("q_A");
    expect(launchIdOf(last([{ type: "opened", id: "q_A" }, seen({ inPending: false, inLive: false })]))).toBe("q_A");
    expect(launchIdOf(last([{ type: "opened", id: "q_A" }, seen({ onDeck: true })]))).toBe("q_A");
  });

  test("once it has shown and left, routing is released (a later single alert can take over)", () => {
    const state = last([
      { type: "opened", id: "q_A" },
      seen({ onDeck: true }),
      seen({ inPending: false, inLive: false, onDeck: false }),
    ]);
    expect(state.phase).toBe("done");
    expect(launchIdOf(state)).toBeNull();
  });

  test("a launched alert the deck keeps off no longer leaves a blank screen", () => {
    const state = last([{ type: "opened", id: "q_A" }, seen({ inPending: true, inLive: false })]);
    expect(launchIdOf(state)).toBeNull();
  });

  test("an alert that never arrives is given up on", () => {
    const state = last([{ type: "opened", id: "q_OLD" }, seen({ inPending: false, inLive: false }), { type: "gaveUp" }]);
    expect(launchIdOf(state)).toBeNull();
  });

  test("lists that have not loaded decide nothing", () => {
    const state = last([{ type: "opened", id: "q_A" }, seen({ loaded: false, inPending: false, inLive: false })]);
    expect(state).toEqual({ phase: "waiting", id: "q_A" });
  });

  test("opened is idempotent, a finished launch stays finished, a new id starts again", () => {
    const done: AlertLaunchState = { phase: "done", id: "q_A" };
    expect(alertLaunchTransition(done, { type: "opened", id: "q_A" })).toBe(done);
    expect(alertLaunchTransition(done, { type: "opened", id: null })).toBe(done);
    expect(alertLaunchTransition(done, { type: "opened", id: "q_B" })).toEqual({ phase: "waiting", id: "q_B" });
  });

  test("gaveUp only ends a launch that is still waiting", () => {
    const shown: AlertLaunchState = { phase: "shown", id: "q_A" };
    expect(alertLaunchTransition(shown, { type: "gaveUp" })).toBe(shown);
  });
});
