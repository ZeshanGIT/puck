import { describe, expect, test } from "bun:test";
import { dismissedQuestionId } from "./dismissPayload";

const DISMISS = { kind: "dismiss", questionId: "q_BEXA0M8Y5W1ADYPX" };

describe("dismissedQuestionId", () => {
  test("reads Expo's dataString, a nested data object and a bare payload", () => {
    expect(dismissedQuestionId({ data: { dataString: JSON.stringify(DISMISS) } })).toBe(DISMISS.questionId);
    expect(dismissedQuestionId({ data: DISMISS })).toBe(DISMISS.questionId);
    expect(dismissedQuestionId(DISMISS)).toBe(DISMISS.questionId);
  });

  test("ignores a full-screen alert, a plain notification and junk", () => {
    expect(dismissedQuestionId({ data: { dataString: JSON.stringify({ ...DISMISS, kind: "fullscreen" }) } })).toBeNull();
    expect(dismissedQuestionId({ data: { questionId: DISMISS.questionId } })).toBeNull();
    expect(dismissedQuestionId({ data: { dataString: "{not json" } })).toBeNull();
    expect(dismissedQuestionId(null)).toBeNull();
    expect(dismissedQuestionId("dismiss")).toBeNull();
    expect(dismissedQuestionId([])).toBeNull();
  });

  test("refuses a question id that is not one", () => {
    expect(dismissedQuestionId({ ...DISMISS, questionId: "nope" })).toBeNull();
    expect(dismissedQuestionId({ ...DISMISS, questionId: 7 })).toBeNull();
    expect(dismissedQuestionId({ kind: "dismiss" })).toBeNull();
  });
});
