import { describe, expect, test } from "bun:test";
import { checkMachine, runMachine } from "@puck/shared";
import { appGate } from "./accountGate";
import {
  appSession,
  appSessionTransition,
  initialAppSession,
  onboardingStatusOf,
  type AppSessionEvent,
  type AppSessionState,
} from "./appSessionMachine";
import { openingVisible } from "./startupGate";

function replay(events: AppSessionEvent[], from: AppSessionState = initialAppSession): AppSessionState {
  return runMachine(appSession, events, from).at(-1) ?? from;
}

describe("appSession machine", () => {
  test("passes the totality and purity check", () => {
    expect(checkMachine(appSession)).toEqual([]);
  });

  test("a first launch reads onboarding, walks the steps and finishes", () => {
    const states = runMachine(appSession, [
      { type: "onboardingRead", done: false },
      { type: "stepAdvanced", next: "test" },
      { type: "stepAdvanced", next: "first-bot" },
      { type: "onboardingFinished" },
    ]);
    expect(states.map((state) => [state.onboarding, state.step])).toEqual([
      ["incomplete", null],
      ["incomplete", "test"],
      ["incomplete", "first-bot"],
      ["complete", null],
    ]);
  });

  test("the first onboarding read wins", () => {
    const state = replay([
      { type: "onboardingRead", done: false },
      { type: "stepAdvanced", next: "test" },
      { type: "onboardingRead", done: true },
    ]);
    expect(state.onboarding).toBe("incomplete");
    expect(state.step).toBe("test");
  });

  test("the fresh sign-in latch ends when the phone registers", () => {
    const signedIn = replay([{ type: "signInStarted" }]);
    expect(signedIn.freshSignIn).toBe(true);
    expect(replay([{ type: "registrationReady" }], signedIn).freshSignIn).toBe(false);
  });

  test("a failed sign-in does not leave the latch on", () => {
    expect(replay([{ type: "signInStarted" }, { type: "signInFailed" }]).freshSignIn).toBe(false);
  });

  test("the opening cover starts again after the inbox is left, not only after our own sign-out", () => {
    const shown = replay([{ type: "onboardingRead", done: true }, { type: "inboxReady" }]);
    expect(shown.inboxReady).toBe(true);
    const left = replay([{ type: "leftInbox" }], shown);
    expect(left.inboxReady).toBe(false);
    expect(left.timedOut).toBe(false);
    expect(openingVisible({ gate: "inbox", signingOut: false, inboxReady: left.inboxReady, timedOut: left.timedOut })).toBe(true);
  });

  test("signing out resets the cover and ignores a late inbox report", () => {
    const state = replay([
      { type: "onboardingRead", done: true },
      { type: "inboxReady" },
      { type: "signOutStarted" },
      { type: "inboxReady" },
      { type: "inboxTimedOut" },
    ]);
    expect(state.signingOut).toBe(true);
    expect(state.inboxReady).toBe(false);
    expect(state.timedOut).toBe(false);
    expect(replay([{ type: "signOutFinished" }], state).signingOut).toBe(false);
  });

  test("clearing local data drops the sign-in latch and the step", () => {
    const state = replay([
      { type: "onboardingRead", done: false },
      { type: "signInStarted" },
      { type: "stepAdvanced", next: "test" },
      { type: "localCleared" },
    ]);
    expect(state.freshSignIn).toBe(false);
    expect(state.step).toBeNull();
  });

  test("the dev walkthrough replays steps on a phone that already finished onboarding", () => {
    const done = replay([{ type: "onboardingRead", done: true }, { type: "devWalkthroughRead", active: true }]);
    expect(onboardingStatusOf(done, true)).toBe("incomplete");
    expect(onboardingStatusOf(done, false)).toBe("complete");
    const stepped = replay([{ type: "stepAdvanced", next: "test" }], done);
    expect(stepped.step).toBe("test");
    const finished = replay([{ type: "onboardingFinished" }], stepped);
    expect(finished.devWalkthrough).toBe(false);
    expect(finished.step).toBeNull();
  });

  test("a step cannot be set once onboarding is complete outside the walkthrough", () => {
    const done = replay([{ type: "onboardingRead", done: true }]);
    expect(replay([{ type: "stepAdvanced", next: "test" }], done)).toEqual(done);
  });

  test("feeds the gate: a signed-in phone that finished onboarding reaches the inbox", () => {
    const state = replay([{ type: "onboardingRead", done: true }]);
    expect(
      appGate({
        clerk: "in",
        registration: "ready",
        onboarding: onboardingStatusOf(state, false),
        step: state.step,
        freshSignIn: state.freshSignIn,
      }),
    ).toBe("inbox");
  });
});
