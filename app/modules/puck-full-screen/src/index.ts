import { requireNativeModule } from "expo";

type FullScreenNative = {
  canUse: () => boolean;
  leaveIfLocked?: () => boolean;
};

function nativeModule(): FullScreenNative | null {
  try {
    return requireNativeModule<FullScreenNative>("PuckFullScreenAccess");
  } catch {
    return null;
  }
}

/** True when Android will allow an urgent alert to take the lock screen. */
export function canUseFullScreenIntent(): boolean {
  try {
    return nativeModule()?.canUse() === true;
  } catch {
    return false;
  }
}

/**
 * After the last answer, leave the screen if the phone is still locked.
 * The installed app returns false until this native function is on the phone.
 */
export function leaveIfLocked(): boolean {
  try {
    return nativeModule()?.leaveIfLocked?.() === true;
  } catch {
    return false;
  }
}
