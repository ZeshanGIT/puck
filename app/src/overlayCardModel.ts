/**
 * The compact alert card drawn over other apps when the phone is unlocked (Android's
 * SYSTEM_ALERT_WINDOW, granted by the person in Android's settings). Pure rules and text, so they
 * can be unit-tested without React Native. The card itself is native (`OverlayCard.kt`).
 */
import type { AlertPriority } from "./localSettings";
import { darkTokens, lightTokens } from "./ui/tokens";

export interface OverlayCardInput {
  /** The lock screen is showing. Null when the build cannot tell; the card then stays away. */
  locked: boolean | null;
  /** The person allowed Puck to draw over other apps. */
  allowed: boolean;
  /** A phone call is running: the alert waits for it to end, as before. */
  inCall: boolean;
}

/**
 * A locked phone keeps the full-screen alert (it covers the lock screen), so the card is only for
 * an unlocked phone, and only when the person has allowed it.
 */
export function shouldShowOverlayCard(input: OverlayCardInput): boolean {
  return input.locked === false && input.allowed && !input.inCall;
}

export interface OverlayCardText {
  label: string;
  title: string;
  body: string;
}

export function overlayCardText(alert: { priority: AlertPriority; botName: string; question: string }): OverlayCardText {
  return {
    label: alert.priority === "urgent" ? "Urgent alert" : "Alert",
    title: alert.botName,
    body: alert.question,
  };
}

export interface OverlayPalette {
  background: string;
  ink: string;
  ink2: string;
  accent: string;
}

/** The card wears the same tokens as the rest of the app: the card surface, the inks and the urgent red. */
export function overlayPalette(dark: boolean, priority: AlertPriority): OverlayPalette {
  const tokens = dark ? darkTokens : lightTokens;
  return {
    background: tokens.card,
    ink: tokens.ink,
    ink2: tokens.ink2,
    accent: priority === "urgent" ? tokens.danger : tokens.ink3,
  };
}
