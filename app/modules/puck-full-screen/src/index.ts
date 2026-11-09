import { requireNativeModule } from "expo";

type FullScreenNative = {
  canUse: () => boolean;
  leaveIfLocked?: () => boolean;
  goBack?: () => boolean;
  hasDndAccess?: () => boolean;
  isLocked?: () => boolean;
  isInCall?: () => boolean;
  createAlarmChannel?: (id: string, name: string, bypassDnd: boolean, headsUp: boolean) => boolean;
  watchVolumeKeys?: () => boolean;
  requestUnlock?: () => Promise<string>;
  canDrawOverlay?: () => boolean;
  showOverlayCard?: (card: Record<string, string | number>) => boolean;
  hideOverlayCard?: (questionId: string) => boolean;
  takeOverlayOpen?: () => { questionId: string; snooze: boolean; snoozeMinutes?: number; nonce?: number } | null;
  pendingOverlayReplies?: () => { questionId: string; text: string; nonce: number }[];
  clearOverlayReply?: (nonce: number) => boolean;
  addListener?: (
    eventName: "onVolumeKey" | "onOverlayOpen" | "onOverlayAction",
    listener: (event?: {
      questionId: string;
      snooze?: boolean;
      snoozeMinutes?: number;
      nonce?: number;
      action?: "dismiss" | "snooze" | "reply";
      text?: string;
    }) => void,
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
 * vibrate mode do not mute it, optionally overriding Do Not Disturb. `headsUp` false keeps the sound
 * but not the banner over other apps. Settings are fixed once the channel exists. False when it
 * could not be created.
 */
export function createAlarmChannel(id: string, name: string, bypassDnd: boolean, headsUp: boolean): boolean {
  try {
    return nativeModule()?.createAlarmChannel?.(id, name, bypassDnd, headsUp) === true;
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
  /** The bot's base colour and its deep edge colour, and the text colour that sits on the bot colour. */
  botColour: string;
  botDeep: string;
  onBot: string;
  /** The blob: body fill, rim ("" for none), body path in a 100 x 100 box, and tilt in degrees. */
  blobFill: string;
  blobRim: string;
  blobPath: string;
  blobTilt: number;
  /** The colour the card grows into when it is pulled down: the app's screen background. */
  screen: string;
}

/** Shows the compact card for an alert, replacing one already up. False without the permission. Never throws. */
export function showOverlayCard(card: OverlayCardContent): boolean {
  try {
    return nativeModule()?.showOverlayCard?.({ ...card }) === true;
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

/**
 * An open from the compact card: the alert, and whether a snooze was chosen. `snoozeMinutes` is 0
 * for the Snooze button (show the choices), the length a swipe picked (5 or 10), or -1 for "until
 * I'm back".
 */
export interface OverlayOpen {
  questionId: string;
  snooze: boolean;
  snoozeMinutes: number;
  /** Unique per request (0 from an older build), so one request arriving twice is acted on once. */
  nonce: number;
}

/**
 * A dismiss, snooze or reply on the compact card, reported while the app is running. A reply
 * carries its `text`; `nonce` is unique per reply, so it can be cleared once it is taken.
 */
export interface OverlayAction {
  questionId: string;
  action: "dismiss" | "snooze" | "reply";
  text?: string;
  nonce?: number;
}

/** A reply typed on the compact card and kept on the phone until JavaScript takes it. */
export interface OverlayReply {
  questionId: string;
  text: string;
  nonce: number;
}

/** Replies typed on the card that JavaScript has not taken yet (for example, while Puck was closed). */
export function takeOverlayReplies(): OverlayReply[] {
  try {
    return nativeModule()?.pendingOverlayReplies?.() ?? [];
  } catch {
    return [];
  }
}

/** Forgets one card reply once it is sent or queued. Never throws. */
export function clearOverlayReply(nonce: number): void {
  try {
    nativeModule()?.clearOverlayReply?.(nonce);
  } catch {
    // Already cleared, or this build predates the function.
  }
}

/** The card open that started a cold start, taken once; null otherwise. */
export function takeOverlayOpen(): OverlayOpen | null {
  try {
    const opened = nativeModule()?.takeOverlayOpen?.();
    return opened
      ? { questionId: opened.questionId, snooze: opened.snooze === true, snoozeMinutes: opened.snoozeMinutes ?? 0, nonce: opened.nonce ?? 0 }
      : null;
  } catch {
    return null;
  }
}

/** Calls `listener` when a tap on the card (or its Snooze) arrives while the app is running. */
export function subscribeOverlayOpen(listener: (open: OverlayOpen) => void): () => void {
  try {
    const native = nativeModule();
    if (!native?.addListener) return () => {};
    const subscription = native.addListener("onOverlayOpen", (event) => {
      if (event) listener({ questionId: event.questionId, snooze: event.snooze === true, snoozeMinutes: event.snoozeMinutes ?? 0, nonce: event.nonce ?? 0 });
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** Calls `listener` when the card is dismissed or snoozed, so JavaScript can stop the alert's speech. */
export function subscribeOverlayAction(listener: (action: OverlayAction) => void): () => void {
  try {
    const native = nativeModule();
    if (!native?.addListener) return () => {};
    const subscription = native.addListener("onOverlayAction", (event) => {
      if (event?.action) {
        listener({ questionId: event.questionId, action: event.action, text: event.text, nonce: event.nonce });
      }
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
