/**
 * The words and timings of A7 (receipt), A9 (no longer needed) and A11 (snooze), with no React
 * Native imports so `bun test` can load them. Copy is the prototype's
 * (`vault/Projects/Puck/mockups/Puck prototype.html`: `receiptHTML`, `goneCard`, `openSheet("snooze")`)
 * and the A7, A9, A10 and A11 entries of `App screens.md`.
 */
import type { ReceiptState } from "@puck/shared";

/* ------------------------------------------------------------------ A7 */

/** What the receipt shows. `queued` is local (the answer waits on the phone, A10); the rest follow the answer. */
export type ReceiptViewState = "sending" | "sent" | "delivered" | "failed" | "queued";

export type StatusTone = "plain" | "ok" | "warn";

export interface ReceiptLine {
  text: string;
  tone: StatusTone;
  /** The glyph before the text. */
  icon: "spinner" | "check" | "warn";
}

export interface ReceiptLineOptions {
  /** Delivery has used every automatic attempt; no further retries are scheduled. */
  exhausted?: boolean;
}

/** `rstat` in the prototype's `receiptHTML`, plus the `failed` line from A10 ("Puck will keep trying"). */
export function receiptLine(state: ReceiptViewState, botName: string, options: ReceiptLineOptions = {}): ReceiptLine {
  const exhausted = options.exhausted === true;
  switch (state) {
    case "sending":
      return { text: "Sending…", tone: "plain", icon: "spinner" };
    case "queued":
      return { text: "Waiting for network. It'll send by itself.", tone: "warn", icon: "warn" };
    case "sent":
      return { text: "Sent", tone: "plain", icon: "check" };
    case "failed":
      return exhausted
        ? {
            text: `Couldn't reach ${botName}. Fix the webhook on the computer, then try again from the alert.`,
            tone: "warn",
            icon: "warn",
          }
        : { text: `Couldn't reach ${botName}. Puck will keep trying.`, tone: "warn", icon: "warn" };
    case "delivered":
      return { text: `Delivered to ${botName}`, tone: "ok", icon: "check" };
  }
}

/** The receipt closes itself this long after "Delivered to ..." shows ("a second or two", A7). */
export const RECEIPT_DELIVERED_CLOSE_MS = 1500;
/** Failed and queued receipts have nothing more to wait for: he can leave (A10). */
export const RECEIPT_SETTLED_CLOSE_MS = 4000;

/** How long until the receipt closes by itself, or null while it still waits for the next state. */
export function receiptCloseDelayMs(state: ReceiptViewState): number | null {
  if (state === "delivered") return RECEIPT_DELIVERED_CLOSE_MS;
  if (state === "failed" || state === "queued") return RECEIPT_SETTLED_CLOSE_MS;
  return null;
}

/**
 * After the last answer (or the A9 card): should Puck send itself to the back? Only when the
 * alert is what launched the app (a notification or the full-screen intent) and the phone was not
 * locked (`leaveIfLocked` already stepped back to the lock screen). When he opened Puck himself,
 * he stays where he is.
 */
export function shouldGoBack(input: { launchedByAlert: boolean; leftLockScreen: boolean }): boolean {
  return input.launchedByAlert && !input.leftLockScreen;
}

/**
 * Joins what was sent into one line for the receipt: "Ship it", or "Ship it, Skip this one".
 * (The prototype stores the answer as one string.)
 */
export function answerSummary(labels: readonly string[]): string {
  return labels.join(", ");
}

/** "+ a photo, report.pdf" (the prototype's `.rr` line for attachments), or null with none. */
export function attachmentSummary(attachments: readonly { type: "photo" | "file"; name: string }[] | undefined): string | null {
  if (!attachments || attachments.length === 0) return null;
  return `+ ${attachments.map((item) => (item.type === "file" ? item.name : "a photo")).join(", ")}`;
}

/**
 * The receipt state from where the answer is:
 * - waiting on the phone: `queued`;
 * - the server's view (`answers.receipt`): `delivered`, `failed` or `sent` win;
 * - otherwise the phone is still sending, or `sent` once the send call has returned.
 */
export function receiptViewState(input: {
  queued: boolean;
  server: ReceiptState | null | undefined;
  sentLocally: boolean;
}): ReceiptViewState {
  if (input.queued) return "queued";
  if (input.server === "delivered" || input.server === "failed" || input.server === "sent") return input.server;
  return input.sentLocally ? "sent" : "sending";
}

/* ------------------------------------------------------------------ A9 */

export type GoneViewReason = "cancelled" | "expired" | "answeredElsewhere";

export interface GoneCopy {
  title: string;
  /** The second line; null when there is nothing to add. */
  sub: string | null;
}

/** "9:40": the hour without a leading zero, 24-hour, as the prototype's clock reads (`21:47`). */
export function clockLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * A9: what happened, in the prototype's words (`SIM.cancel`, `SIM.elsewhere`) and the doc's
 * ("Expired at 9:40", "Answered on MacBook").
 */
export function goneCopy(input: {
  reason: GoneViewReason;
  botName: string;
  clientName?: string;
  /** What he chose on the other client, when known. */
  answerLabels?: readonly string[];
  /** When it expired (epoch ms). */
  expiredAt?: number;
}): GoneCopy {
  switch (input.reason) {
    case "cancelled":
      return { title: `${input.botName} cancelled this`, sub: "They got what they needed in chat." };
    case "expired": {
      const at = typeof input.expiredAt === "number" && input.expiredAt > 0 ? input.expiredAt : undefined;
      return { title: at === undefined ? "Expired" : `Expired at ${clockLabel(at)}`, sub: null };
    }
    case "answeredElsewhere": {
      const labels = input.answerLabels?.filter((label) => label.length > 0) ?? [];
      return {
        title: `Answered on ${input.clientName ?? "another device"}`,
        sub: labels.length > 0 ? `You chose “${labels.join(", ")}” there.` : null,
      };
    }
  }
}

/* ------------------------------------------------------------------ A11 */

export type SnoozeChoiceId = "5m" | "10m" | "back";

export interface SnoozeChoice {
  id: SnoozeChoiceId;
  label: string;
  /** Right-hand hint on the option. */
  detail?: string;
  /** Minutes, or null for "until I'm back". */
  minutes: number | null;
}

/** `sopt` rows of the prototype's snooze sheet, in order. */
export const SNOOZE_CHOICES: readonly SnoozeChoice[] = [
  { id: "5m", label: "5 minutes", minutes: 5 },
  { id: "10m", label: "10 minutes", minutes: 10 },
  { id: "back", label: "Until I'm back", detail: "No reminder", minutes: null },
];

/** The `until` for `answers.snooze`: epoch ms, or null for "until I'm back". */
export function snoozeUntil(choice: SnoozeChoice, now: number): number | null {
  return choice.minutes === null ? null : now + choice.minutes * 60_000;
}

/** The sheet's sentence under its title. */
export function snoozeSheetText(botName: string): string {
  return `It waits under Waiting. ${botName} will know you snoozed.`;
}
