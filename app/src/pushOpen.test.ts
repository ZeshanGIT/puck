import { describe, expect, test } from "bun:test";
import { questionIdFromNotificationData } from "./pushOpen";

describe("questionIdFromNotificationData", () => {
  test("reads a question id and ignores anything else", () => {
    expect(questionIdFromNotificationData({ questionId: "q_BEXA0M8Y5W1ADYPX" })).toBe("q_BEXA0M8Y5W1ADYPX");
    expect(questionIdFromNotificationData({ questionId: "nope" })).toBeNull();
    expect(questionIdFromNotificationData(null)).toBeNull();
  });
});
