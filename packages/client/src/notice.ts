/**
 * A notice: an alert sent with no options. It still gets one button, "Got it", tapped once (the
 * one-option look). The backend needs an option or a reply, so "Got it" goes back to the bot as
 * the reply text with no option chosen: `answers: []`, `customReply: "Got it"`.
 */
export const NOTICE_OPTION_ID = "__got_it";
export const NOTICE_REPLY = "Got it";

/** True when the alert has nothing to pick: the screen shows "Got it" as its one option. */
export function isNotice(alert: { options: readonly unknown[] }): boolean {
  return alert.options.length === 0;
}

/** What to send for the button pressed: the option, or "Got it" as a reply for a notice. */
export function answerFor(optionId: string): { optionIds: string[]; customReply?: string } {
  return optionId === NOTICE_OPTION_ID ? { optionIds: [], customReply: NOTICE_REPLY } : { optionIds: [optionId] };
}
