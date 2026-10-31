import * as IntentLauncher from "expo-intent-launcher";
import { canUseFullScreenIntent } from "puck-full-screen";

const ANDROID_PACKAGE = "in.puckit.app";

export function readFullScreenAllowed(): boolean {
  return canUseFullScreenIntent();
}

export async function openFullScreenSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_APP_USE_FULL_SCREEN_INTENT, {
    data: `package:${ANDROID_PACKAGE}`,
  });
}
