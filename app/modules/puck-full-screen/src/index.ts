import { requireNativeModule } from "expo";

type FullScreenNative = {
  canUse: () => boolean;
  leaveIfLocked?: () => boolean;
  hasDndAccess?: () => boolean;
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

/**
 * True when Do Not Disturb access is allowed for Puck. Null when this build predates the native
 * function, so the caller can fall back to "asked".
 */
export function hasDndAccess(): boolean | null {
  try {
    const native = nativeModule();
    if (!native?.hasDndAccess) return null;
    return native.hasDndAccess() === true;
  } catch {
    return null;
  }
}
