/**
 * Puck plays an alert's ringtone itself (native `RingService`), instead of leaving it to the alert
 * notification's sound: Android plays one notification sound at a time, so any other app's
 * notification used to cut the ringtone off. The notification then rings silently, and Puck has to
 * apply silent mode and Do Not Disturb itself, which Android used to do for the notification.
 * Pure, so the rules can be unit-tested.
 */

/** The phone's ringer mode and whether Do Not Disturb is on (`soundPolicy` in the native module). */
export interface SoundPolicyInput {
  ringer: "normal" | "vibrate" | "silent";
  dnd: boolean;
}

/** What this alert may ring through: its bypass decision (asked for, and allowed for its kind). */
export interface RingDecisionInput {
  dnd: boolean;
  silent: boolean;
}

export type PuckRing =
  /** Ring now, on the ring volume or the alarm volume. */
  | { play: true; stream: "ring" | "alarm" }
  /** Stay quiet: silent mode or Do Not Disturb holds this alert back, as it would hold back its notification. */
  | { play: false };

/**
 * Whether Puck rings for this alert and on which stream:
 * - Do Not Disturb on: only an alert allowed through it rings, on the alarm stream (Do Not
 *   Disturb mutes the ring stream; the alarm stream is how alarms get through).
 * - Silent or vibrate: only an alert allowed through silent mode rings, on the alarm stream
 *   (as before: its own volume, which the phone's silent mode does not mute).
 * - Otherwise it rings on the ring volume, or on the alarm volume when it may ring in silent
 *   mode (unchanged from the notification channels: those alerts always used the alarm stream).
 */
export function puckRing(decision: RingDecisionInput, policy: SoundPolicyInput): PuckRing {
  if (policy.dnd && !decision.dnd) return { play: false };
  if (policy.ringer !== "normal" && !decision.silent) return { play: false };
  return { play: true, stream: decision.silent || policy.dnd ? "alarm" : "ring" };
}
