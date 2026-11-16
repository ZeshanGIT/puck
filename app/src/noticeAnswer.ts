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

/** The options to draw: the alert's own, or the single "Got it" for a notice. */
export function shownOptions<T extends { id: string; label: string }>(options: readonly T[]): readonly T[] {
  // The stand-in has only an id and a label; every other option field is optional.
  return options.length > 0 ? options : [{ id: NOTICE_OPTION_ID, label: NOTICE_REPLY } as T];
}

/** What to send for the button pressed: the option, or "Got it" as a reply for a notice. */
export function answerFor(optionId: string): { optionIds: string[]; customReply?: string } {
  return optionId === NOTICE_OPTION_ID ? { optionIds: [], customReply: NOTICE_REPLY } : { optionIds: [optionId] };
}
