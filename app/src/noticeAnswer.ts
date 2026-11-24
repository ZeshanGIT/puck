import { NOTICE_OPTION_ID, NOTICE_REPLY } from "@puck/client";

export { answerFor, isNotice, NOTICE_OPTION_ID, NOTICE_REPLY } from "@puck/client";

/** The options to draw: the alert's own, or the single "Got it" for a notice. */
export function shownOptions<T extends { id: string; label: string }>(options: readonly T[]): readonly T[] {
  // The stand-in has only an id and a label; every other option field is optional.
  return options.length > 0 ? options : [{ id: NOTICE_OPTION_ID, label: NOTICE_REPLY } as T];
}
