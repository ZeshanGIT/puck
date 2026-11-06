import { requireNativeModule } from "expo";

type FullScreenNative = {
  canUse: () => boolean;
  leaveIfLocked?: () => boolean;
  goBack?: () => boolean;
  hasDndAccess?: () => boolean;
  isLocked?: () => boolean;
  isInCall?: () => boolean;
  createAlarmChannel?: (id: string, name: string, bypassDnd: boolean) => boolean;
  watchVolumeKeys?: () => boolean;
  requestUnlock?: () => Promise<string>;
  addListener?: (eventName: "onVolumeKey", listener: () => void) => { remove: () => void };
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
 * Sends Puck to the back, so the app he was in (or the home screen) is showing again. Used after
 * the alert screen is done and the phone is not locked. Returns false when there is no activity,
 * and in a build that predates this native function. Never throws.
 */
export function goBack(): boolean {
  try {
    return nativeModule()?.goBack?.() === true;
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

/**
 * True while the lock screen is showing, which is when an urgent alert covers it. Null when this
 * build predates the native function.
 */
export function isLocked(): boolean | null {
  try {
    const native = nativeModule();
    if (!native?.isLocked) return null;
    return native.isLocked() === true;
  } catch {
    return null;
  }
}

/**
 * True while the phone is in a call (or one is ringing, or a voice call runs in another app).
 * False when this build predates the native function, so an alert rings as usual.
 */
export function isInCall(): boolean {
  try {
    return nativeModule()?.isInCall?.() === true;
  } catch {
    return false;
  }
}

/** True when this build can create a channel on the alarm audio stream. */
export function canCreateAlarmChannel(): boolean {
  try {
    return typeof nativeModule()?.createAlarmChannel === "function";
  } catch {
    return false;
  }
}

/**
 * Creates (or finds) a notification channel that rings on the alarm audio stream, so silent and
 * vibrate mode do not mute it, optionally overriding Do Not Disturb. Settings are fixed once the
 * channel exists. False when it could not be created.
 */
export function createAlarmChannel(id: string, name: string, bypassDnd: boolean): boolean {
  try {
    return nativeModule()?.createAlarmChannel?.(id, name, bypassDnd) === true;
  } catch {
    return false;
  }
}

/**
 * Calls `listener` when a volume key goes down in the app's window (the key still works as
 * usual). Returns the function that stops listening. Does nothing in a build without the native
 * hook.
 */
export function onVolumeKey(listener: () => void): () => void {
  try {
    const native = nativeModule();
    if (!native?.addListener) return () => {};
    native.watchVolumeKeys?.();
    const subscription = native.addListener("onVolumeKey", listener);
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** How a request to dismiss the lock screen ended. */
export type UnlockResult = "unlocked" | "cancelled" | "error";

/**
 * Asks Android to dismiss the lock screen (fingerprint or PIN where set; a swipe lock goes with no
 * prompt). Resolves at once with "unlocked" when the phone is not locked. In a build without the
 * native function it is "unlocked" only when the phone is known to be unlocked, otherwise "error".
 * Never throws.
 */
export async function requestUnlock(): Promise<UnlockResult> {
  try {
    const native = nativeModule();
    if (!native?.requestUnlock) return isLocked() === false ? "unlocked" : "error";
    const result = await native.requestUnlock();
    return result === "unlocked" || result === "cancelled" ? result : "error";
  } catch {
    return "error";
  }
}
