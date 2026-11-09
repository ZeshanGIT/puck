/**
 * App session lifecycle: the local flags `AppBody` used to keep as seven separate `useState`s.
 *
 * Clerk's status and this phone's registration come from hooks outside this machine; `appGate`
 * (accountGate.ts) combines them with the fields here to pick the screen. What this machine owns:
 *
 * - where onboarding stands (`onboarding`, `step`, the dev `devWalkthrough`);
 * - whether the person just signed in on O1 (`freshSignIn`), which keeps O1 up with a busy button
 *   instead of dropping to O0 while the phone registers;
 * - the sign-out in progress (`signingOut`);
 * - the opening cover over the inbox (`inboxReady`, `timedOut`): O0 stays up until the inbox has
 *   its first data or the safety timeout runs out (startupGate.ts).
 *
 *   reading --onboardingRead--> onboarding step (incomplete) | inbox (complete)
 *   incomplete --stepAdvanced / onboardingFinished--> next step | complete
 *   any --signOutStarted--> signing-out --signOutFinished--> (the gate decides)
 *
 * Rules that used to be implicit, and are now stated here:
 * - `freshSignIn` ends when the phone registers (`registrationReady`), when sign-in fails
 *   (`signInFailed`) and when local data is cleared. It used to stay true for the whole session.
 * - The inbox cover latches (`inboxReady`, `timedOut`) start again whenever the app leaves the
 *   inbox (`leftInbox`), not only during our own sign-out, so a server-side sign-out or the dev
 *   replay no longer shows an empty Home that fills in.
 * - The first onboarding read wins; a later read cannot undo a step the person already took.
 * - A step can advance while onboarding is incomplete, or while the dev walkthrough is on (it
 *   replays the steps on a phone that already finished onboarding).
 * - `inboxReady` and `inboxTimedOut` are ignored while signing out.
 */
import { defineMachine } from "@puck/shared";
import type { OnboardingStatus, OnboardingStep } from "./accountGate";

export interface AppSessionState {
  /** What the stored flag says: `unknown` until the first read finishes. */
  onboarding: OnboardingStatus;
  /** The dev "walk through every step" mode is on (dev builds only; the host gates on `__DEV__`). */
  devWalkthrough: boolean;
  /** The onboarding step the person is on; null means "the first step after sign-in" (O2). */
  step: OnboardingStep | null;
  freshSignIn: boolean;
  signingOut: boolean;
  /** The inbox reported its first data. */
  inboxReady: boolean;
  /** The safety timeout ran out before the inbox was ready. */
  timedOut: boolean;
}

export type AppSessionEvent =
  | { type: "onboardingRead"; done: boolean }
  | { type: "devWalkthroughRead"; active: boolean }
  | { type: "signInStarted" }
  | { type: "signInFailed" }
  | { type: "registrationReady" }
  | { type: "leftInbox" }
  | { type: "signOutStarted" }
  | { type: "localCleared" }
  | { type: "signOutFinished" }
  | { type: "walkThroughStarted" }
  | { type: "stepAdvanced"; next: OnboardingStep }
  | { type: "onboardingFinished" }
  | { type: "inboxReady" }
  | { type: "inboxTimedOut" };

export const initialAppSession: AppSessionState = {
  onboarding: "unknown",
  devWalkthrough: false,
  step: null,
  freshSignIn: false,
  signingOut: false,
  inboxReady: false,
  timedOut: false,
};

export function appSessionTransition(state: AppSessionState, event: AppSessionEvent): AppSessionState {
  switch (event.type) {
    case "onboardingRead":
      if (state.onboarding !== "unknown") return state;
      return { ...state, onboarding: event.done ? "complete" : "incomplete" };
    case "devWalkthroughRead":
      return state.devWalkthrough === event.active ? state : { ...state, devWalkthrough: event.active };
    case "signInStarted":
      return state.freshSignIn ? state : { ...state, freshSignIn: true };
    case "signInFailed":
    case "registrationReady":
      return state.freshSignIn ? { ...state, freshSignIn: false } : state;
    case "leftInbox":
      return state.inboxReady || state.timedOut ? { ...state, inboxReady: false, timedOut: false } : state;
    case "signOutStarted":
      return { ...state, signingOut: true, inboxReady: false, timedOut: false };
    case "localCleared":
      return state.freshSignIn || state.step !== null ? { ...state, freshSignIn: false, step: null } : state;
    case "signOutFinished":
      return state.signingOut ? { ...state, signingOut: false } : state;
    case "walkThroughStarted":
      return { ...state, devWalkthrough: true, onboarding: "incomplete", step: "welcome" };
    case "stepAdvanced":
      return state.onboarding === "incomplete" || state.devWalkthrough ? { ...state, step: event.next } : state;
    case "onboardingFinished":
      return { ...state, devWalkthrough: false, onboarding: "complete", step: null };
    case "inboxReady":
      return state.signingOut || state.inboxReady ? state : { ...state, inboxReady: true };
    case "inboxTimedOut":
      return state.signingOut || state.timedOut ? state : { ...state, timedOut: true };
  }
}

/** The onboarding status the gate sees: the dev walkthrough forces "incomplete" in dev builds. */
export function onboardingStatusOf(state: AppSessionState, devBuild: boolean): OnboardingStatus {
  return state.devWalkthrough && devBuild ? "incomplete" : state.onboarding;
}

function invariant(state: AppSessionState): string | null {
  if (state.step !== null && state.onboarding === "complete" && !state.devWalkthrough) {
    return "a step is set but onboarding is complete";
  }
  if (state.signingOut && (state.inboxReady || state.timedOut)) return "signing out but the inbox cover latched";
  return null;
}

function label(state: AppSessionState): string {
  if (state.signingOut) return "signing_out";
  if (state.onboarding === "unknown") return "reading";
  if (state.onboarding === "incomplete") return `onboarding_${state.step ?? "permissions"}`;
  if (state.inboxReady) return "inbox_ready";
  return state.timedOut ? "inbox_timed_out" : "inbox_loading";
}

export const appSession = defineMachine<AppSessionState, AppSessionEvent>({
  name: "app-session",
  summary:
    "Local session flags of the app root: onboarding progress, the fresh sign-in latch, sign-out in progress and the opening cover over the inbox.",
  usedBy: ["app/App.tsx", "app/src/accountGate.ts", "app/src/startupGate.ts"],
  initial: initialAppSession,
  transition: appSessionTransition,
  label,
  invariant,
  samples: {
    states: [
      initialAppSession,
      { ...initialAppSession, onboarding: "incomplete" },
      { ...initialAppSession, onboarding: "incomplete", step: "test", freshSignIn: true },
      { ...initialAppSession, onboarding: "incomplete", step: "welcome", devWalkthrough: true },
      { ...initialAppSession, onboarding: "complete" },
      { ...initialAppSession, onboarding: "complete", inboxReady: true },
      { ...initialAppSession, onboarding: "complete", timedOut: true },
      { ...initialAppSession, onboarding: "complete", signingOut: true },
    ],
    events: [
      { type: "onboardingRead", done: true },
      { type: "onboardingRead", done: false },
      { type: "devWalkthroughRead", active: true },
      { type: "signInStarted" },
      { type: "signInFailed" },
      { type: "registrationReady" },
      { type: "leftInbox" },
      { type: "signOutStarted" },
      { type: "localCleared" },
      { type: "signOutFinished" },
      { type: "walkThroughStarted" },
      { type: "stepAdvanced", next: "test" },
      { type: "onboardingFinished" },
      { type: "inboxReady" },
      { type: "inboxTimedOut" },
    ],
  },
});
