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
  canDrawOverlay?: () => boolean;
  showOverlayCard?: (
    questionId: string,
    label: string,
    title: string,
    body: string,
    background: string,
    ink: string,
    ink2: string,
    accent: string,
  ) => boolean;
  hideOverlayCard?: (questionId: string) => boolean;
  takeOverlayOpen?: () => string | null;
  addListener?: (
    eventName: "onVolumeKey" | "onOverlayOpen",
    listener: (event?: { questionId: string }) => void,
  ) => { remove: () => void };
};

function nativeModule(): FullScreenNative | null {
  try {
    return requireNativeModule<FullScreenNative>("PuckFullScreenAccess");
  } catch {
    return null;
  }
}

/** True when Android will allow full-screen alert presentation over the lock screen. */
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

/** True when Puck may draw the compact alert card over other apps (the person grants it in Android). */
export function canDrawOverlay(): boolean {
  try {
    return nativeModule()?.canDrawOverlay?.() === true;
  } catch {
    return false;
  }
}

export interface OverlayCardContent {
  questionId: string;
  label: string;
  title: string;
  body: string;
  background: string;
  ink: string;
  ink2: string;
  accent: string;
}

/** Shows the compact card for an alert, replacing one already up. False without the permission. Never throws. */
export function showOverlayCard(card: OverlayCardContent): boolean {
  try {
    return (
      nativeModule()?.showOverlayCard?.(
        card.questionId,
        card.label,
        card.title,
        card.body,
        card.background,
        card.ink,
        card.ink2,
        card.accent,
      ) === true
    );
  } catch {
    return false;
  }
}

/** Removes the card when it is showing this alert. Never throws. */
export function hideOverlayCard(questionId: string): void {
  try {
    nativeModule()?.hideOverlayCard?.(questionId);
  } catch {
    // No card is drawn, or it is already gone.
  }
}

/** The alert a tap on the compact card opened on a cold start, taken once; null otherwise. */
export function takeOverlayOpen(): string | null {
  try {
    return nativeModule()?.takeOverlayOpen?.() ?? null;
  } catch {
    return null;
  }
}

/** Calls `listener` with the alert id when a tap on the card arrives while the app is running. */
export function subscribeOverlayOpen(listener: (questionId: string) => void): () => void {
  try {
    const native = nativeModule();
    if (!native?.addListener) return () => {};
    const subscription = native.addListener("onOverlayOpen", (event) => {
      if (event) listener(event.questionId);
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
