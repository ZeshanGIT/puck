import { describe, expect, test } from "bun:test";
import { fullscreenAlert } from "./fullscreenPayload";

const ALERT = {
  kind: "fullscreen",
  questionId: "q_BEXA0M8Y5W1ADYPX",
  question: "Lock screen?",
  botName: "test",
  priority: "urgent",
};

describe("fullscreenAlert", () => {
  test("reads Expo's dataString and ignores a shade notification", () => {
    expect(fullscreenAlert({ data: { dataString: JSON.stringify(ALERT) } })).toEqual({
      questionId: ALERT.questionId,
      question: ALERT.question,
      botName: ALERT.botName,
    });
    expect(fullscreenAlert({ data: { questionId: ALERT.questionId } })).toBeNull();
    expect(fullscreenAlert(null)).toBeNull();
  });
});
