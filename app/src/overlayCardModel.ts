/**
 * The compact alert card drawn over other apps when the phone is unlocked (Android's
 * SYSTEM_ALERT_WINDOW, granted by the person in Android's settings). Pure rules and text, so they
 * can be unit-tested without React Native. The card itself is native (`OverlayCard.kt`).
 */
import type { AlertPriority } from "./localSettings";
import { SHAPES, type BlobBot } from "./ui/blobShapes";
import { botTheme } from "./ui/botTheme";
import { darkTokens, lightTokens } from "./ui/tokens";

export interface OverlayCardInput {
  /** The lock screen is showing. Null when the build cannot tell; the card then stays away. */
  locked: boolean | null;
  /** The person allowed Puck to draw over other apps. */
  allowed: boolean;
  /** A phone call is running: the alert waits for it to end, as before. */
  inCall: boolean;
  /** A Puck screen is already on the display (the app is open, or a full-screen alert is up). */
  appOpen: boolean;
  /** The screen is on. When it is off, the full-screen alert wakes it and covers it. */
  screenOn: boolean;
}

/**
 * The card is only for an unlocked phone, with the screen on, while the person is in another app,
 * and only when they have allowed it. A locked phone, a screen that is off, or Puck already open
 * all show the full-screen alert instead, and the card must not appear on top of it.
 */
export function shouldShowOverlayCard(input: OverlayCardInput): boolean {
  return input.locked === false && input.allowed && !input.inCall && !input.appOpen && input.screenOn;
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

/**
 * What the card needs to draw the bot: its blob (body path in a 100 x 100 box, tilt, fill, and the
 * light rim the black bot wears on dark surfaces), the colours of its snooze reveal, and the screen
 * colour the card grows into when it is pulled down (white, or the dark theme's background).
 */
export interface OverlayBotLook {
  botColour: string;
  botDeep: string;
  /** Text and icon colour on the bot colour. */
  onBot: string;
  blobFill: string;
  /** Empty when the blob has no rim. */
  blobRim: string;
  blobPath: string;
  blobTilt: number;
  screen: string;
}

/**
 * `#rgb` as `#rrggbb`. Android's `Color.parseColor` takes only six or eight digits, and the bot
 * theme has short ones (`#fff`, `#000`); a card given one would not be drawn at all.
 */
export function hex6(colour: string): string {
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(colour);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : colour;
}

export function overlayBotLook(bot: BlobBot, dark: boolean): OverlayBotLook {
  const theme = botTheme({ colour: bot.colour }, { dark });
  return {
    botColour: hex6(theme.bot),
    botDeep: hex6(theme.botDeep),
    onBot: hex6(theme.onBot),
    blobFill: hex6(theme.blobFill),
    blobRim: theme.blobOutline ? hex6(theme.blobOutline) : "",
    blobPath: SHAPES[bot.shape],
    blobTilt: bot.tilt,
    screen: hex6((dark ? darkTokens : lightTokens).bg),
  };
}
