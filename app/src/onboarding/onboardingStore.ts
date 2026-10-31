import * as SecureStore from "expo-secure-store";

const ONBOARDING_KEY = "puck.onboardingComplete";

export type OnboardingFlag = boolean | null;

export function readOnboardingComplete(): Promise<boolean> {
  return SecureStore.getItemAsync(ONBOARDING_KEY).then((value) => value === "1");
}

export function markOnboardingComplete(): Promise<void> {
  return SecureStore.setItemAsync(ONBOARDING_KEY, "1");
}

/** Dev-only reset helper; not wired in UI. */
export function clearOnboardingComplete(): Promise<void> {
  return SecureStore.deleteItemAsync(ONBOARDING_KEY);
}
