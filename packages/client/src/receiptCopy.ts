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
