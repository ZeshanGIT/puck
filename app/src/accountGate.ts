export type GateStatus = "unknown" | "out" | "in";
export type OnboardingStatus = "unknown" | "incomplete" | "complete";

/**
 * Whether this phone is signed in to Convex with its Clerk token and registered as a client.
 * `pending` while that is being worked out; `attention` when the person has to do something
 * (a name clash to resolve, or a failure with a Retry).
 */
export type RegistrationStatus = "pending" | "ready" | "attention";

/** The onboarding steps after sign-in. `welcome` is only set by the dev walkthrough. */
export type OnboardingStep = "welcome" | "permissions" | "test" | "first-bot";

/** O0 opening, O1 welcome, O2 permissions, O3 test page, O4 first bot, then the inbox. */
export type AppGate = "opening" | "welcome" | "permissions" | "test" | "first-bot" | "inbox";

const STEP_ORDER: OnboardingStep[] = ["welcome", "permissions", "test", "first-bot"];

/** The step after `step`, or null when onboarding is finished. */
export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return STEP_ORDER[STEP_ORDER.indexOf(step) + 1] ?? null;
}

/**
 * Which screen the app shows.
 *
 * - Signed out, or signed in but not yet registered with something to fix: O1.
 * - Checking the session and this phone's registration: O0, except right after signing in on
 *   O1, which stays on O1 with its button busy (`freshSignIn`).
 * - A signed-in, registered phone that finished onboarding goes straight to the inbox.
 * - Otherwise the onboarding step the person is on (O2 when none is set yet, such as after a
 *   restart in the middle of onboarding).
 */
export function appGate(input: {
  clerk: GateStatus;
  registration: RegistrationStatus;
  onboarding: OnboardingStatus;
  step: OnboardingStep | null;
  freshSignIn: boolean;
}): AppGate {
  if (input.clerk === "unknown" || input.onboarding === "unknown") return "opening";
  if (input.clerk === "out") return "welcome";
  if (input.registration === "attention") return "welcome";
  if (input.registration === "pending") return input.freshSignIn ? "welcome" : "opening";
  if (input.onboarding === "complete") return "inbox";
  return input.step ?? "permissions";
}
