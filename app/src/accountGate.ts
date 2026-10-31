export type GateStatus = "unknown" | "out" | "in";
export type AccountGate = "opening" | "sign-in" | "claim" | "inbox";
export type OnboardingStatus = "unknown" | "incomplete" | "complete";
export type AppGate = "opening" | "onboarding" | "inbox";

/** Google sign-in comes first. The setup code stays until this phone has already been claimed. */
export function accountGate(clerk: GateStatus, device: GateStatus): AccountGate {
  if (clerk === "unknown" || device === "unknown") return "opening";
  if (clerk === "out") return "sign-in";
  if (device === "out") return "claim";
  return "inbox";
}

/** Shell onboarding runs until Clerk, device claim, and the permission walkthrough are done. */
export function appGate(clerk: GateStatus, device: GateStatus, onboarding: OnboardingStatus): AppGate {
  if (clerk === "unknown" || device === "unknown" || onboarding === "unknown") return "opening";
  if (clerk === "out" || device === "out" || onboarding === "incomplete") return "onboarding";
  return "inbox";
}
