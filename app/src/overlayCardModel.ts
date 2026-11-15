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

/** How an alert shows over an unlocked phone in use: the card, the whole screen, or neither. */
export type InUsePresentation = "card" | "fullScreen" | "none";

/**
 * The card, or the whole screen when the person chose full screen for this kind of alert (or this
 * bot). Both need the same conditions: an unlocked phone with the screen on, another app in front,
 * no call, and the "Display over other apps" permission, which is also what lets Puck bring its
 * alert to the front. Anywhere else neither applies: a locked phone gets the full-screen alert the
 * usual way, through the notification.
 */
export function inUsePresentation(input: OverlayCardInput, fullScreen: boolean): InUsePresentation {
  if (!shouldShowOverlayCard(input)) return "none";
  return fullScreen ? "fullScreen" : "card";
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
  /** The card's edge as `#AARRGGBB` (Android's order), drawn just inside its outline. */
  edge: string;
}

/**
 * `#rrggbb` with an alpha in front, as Android's `Color.parseColor` reads eight digits:
 * `#AARRGGBB`, not CSS's `#RRGGBBAA`.
 */
export function androidAlpha(colour: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `#${byte.toString(16).padStart(2, "0").toUpperCase()}${hex6(colour).slice(1)}`;
}

/**
 * The card wears the same tokens as the rest of the app: the card surface, the inks and the urgent red.
 * Its edge has to read on any wallpaper, busy or plain, light or dark: a see-through line of the ink
 * (dark on the light card, light on the dark one) parts the card from what is behind it, and the
 * shadow does the rest. An urgent card's edge is the urgent red.
 */
export function overlayPalette(dark: boolean, priority: AlertPriority): OverlayPalette {
  const tokens = dark ? darkTokens : lightTokens;
  const urgent = priority === "urgent";
  return {
    background: tokens.card,
    ink: tokens.ink,
    ink2: tokens.ink2,
    accent: urgent ? tokens.danger : tokens.ink3,
    edge: urgent ? androidAlpha(tokens.danger, dark ? 0.55 : 0.45) : androidAlpha(tokens.ink, dark ? 0.2 : 0.18),
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
  /**
   * The bot's wash at the top of the alert screen, as `#AARRGGBB`: the card grows into the alert's
   * own look (screen colour plus this wash), so when Puck appears beneath, nothing changes.
   */
  wash: string;
}

/** A CSS colour (`rgba(r, g, b, a)`, `rgb(...)` or `#rrggbb`) as Android's `#AARRGGBB`. */
export function androidColour(colour: string): string {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(colour);
  if (!m) return androidAlpha(colour, 1);
  const hex = [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  return androidAlpha(`#${hex}`, m[4] === undefined ? 1 : Number(m[4]));
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
    wash: androidColour(theme.botWash),
  };
}
