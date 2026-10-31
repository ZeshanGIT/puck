import * as SecureStore from "expo-secure-store";
import { clearOnboardingComplete } from "./onboardingStore";

const DEV_WALKTHROUGH_KEY = "puck.devOnboardingWalkthrough";

function devOnly(): boolean {
  return __DEV__;
}

export async function readDevWalkthrough(): Promise<boolean> {
  if (!devOnly()) return false;
  const value = await SecureStore.getItemAsync(DEV_WALKTHROUGH_KEY);
  return value === "1";
}

/** Clears onboarding completion and replays every step in order. Dev builds only. */
export async function startDevWalkthrough(): Promise<void> {
  if (!devOnly()) return;
  await clearOnboardingComplete();
  await SecureStore.setItemAsync(DEV_WALKTHROUGH_KEY, "1");
}

export async function stopDevWalkthrough(): Promise<void> {
  if (!devOnly()) return;
  await SecureStore.deleteItemAsync(DEV_WALKTHROUGH_KEY);
}
