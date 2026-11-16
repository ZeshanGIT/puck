import { describe, expect, test } from "bun:test";
import { cardChoices } from "./cardChoices";
import { cardReplyItem } from "./cardReply";
import { answerFor, isNotice, NOTICE_OPTION_ID, shownOptions } from "./noticeAnswer";

describe("a notice (an alert with no options)", () => {
  test("shows one Got it button, and leaves real options alone", () => {
    expect(isNotice({ options: [] })).toBe(true);
    expect(shownOptions([])).toEqual([{ id: NOTICE_OPTION_ID, label: "Got it" }]);
    const real = [{ id: "ship", label: "Ship it" }];
    expect(shownOptions(real)).toBe(real);
  });

  test("Got it goes back as a reply with no option; a real option as itself", () => {
    expect(answerFor(NOTICE_OPTION_ID)).toEqual({ optionIds: [], customReply: "Got it" });
    expect(answerFor("ship")).toEqual({ optionIds: ["ship"] });
  });

  test("the card offers Got it too, even when selectionMode said multi", () => {
    for (const selectionMode of ["single", "multi"]) {
      expect(cardChoices({ selectionMode, options: [] })).toEqual([
        { id: NOTICE_OPTION_ID, label: "Got it", desc: "", rec: false, risky: false, open: false },
      ]);
    }
  });

  test("the card's Got it is queued as the reply text, not an option id", () => {
    expect(cardReplyItem("q_JNWGQSBMWNYWZJ3P", "", 5, [NOTICE_OPTION_ID])).toEqual({
      questionId: "q_JNWGQSBMWNYWZJ3P",
      optionIds: [],
      customReply: "Got it",
      queuedAt: 5,
    });
  });
});
