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
      priority: "urgent",
    });
    expect(fullscreenAlert({ data: { questionId: ALERT.questionId } })).toBeNull();
    expect(fullscreenAlert(null)).toBeNull();
  });
});

describe("fullscreenAlert flags", () => {
  const read = (extra: Record<string, unknown>) =>
    fullscreenAlert({ data: { dataString: JSON.stringify({ ...ALERT, ...extra }) } });

  test("reads the string-encoded flags, the ring time and the message", () => {
    expect(
      read({
        ringSeconds: "300",
        speak: "true",
        bypassDnd: "true",
        bypassSilent: "false",
        requiresUnlock: "true",
        alertMessage: "Flight at **10:40**",
      }),
    ).toEqual({
      questionId: ALERT.questionId,
      question: ALERT.question,
      botName: ALERT.botName,
      priority: "urgent",
      ringSeconds: 300,
      speak: true,
      bypassDnd: true,
      bypassSilent: false,
      requiresUnlock: true,
      message: "Flight at **10:40**",
    });
  });

  test("an old payload has none of them and defaults priority to urgent", () => {
    const alert = read({});
    expect(alert).not.toBeNull();
    expect(Object.keys(alert ?? {}).sort()).toEqual(["botName", "priority", "question", "questionId"]);
    expect(alert?.priority).toBe("urgent");
  });

  test("reads normal priority from the payload", () => {
    const alert = read({ priority: "normal" });
    expect(alert?.priority).toBe("normal");
  });

  test("ignores junk and out-of-range values instead of failing", () => {
    const alert = read({ ringSeconds: "99999", speak: "yes", bypassDnd: 1, alertMessage: "" });
    expect(Object.keys(alert ?? {}).sort()).toEqual(["botName", "priority", "question", "questionId"]);
    expect(read({ ringSeconds: "2" })?.ringSeconds).toBeUndefined();
    expect(read({ ringSeconds: 60 })?.ringSeconds).toBe(60);
  });
});

describe("fullscreenAlert bot id", () => {
  test("reads the bot id when the push has one", () => {
    const alert = fullscreenAlert({ data: { dataString: JSON.stringify({ ...ALERT, botId: "sheldon-11019" }) } });
    expect(alert?.botId).toBe("sheldon-11019");
  });

  test("an older push has none, and a wrong type is dropped", () => {
    expect(fullscreenAlert(ALERT)?.botId).toBeUndefined();
    expect(fullscreenAlert({ ...ALERT, botId: 7 })?.botId).toBeUndefined();
    expect(fullscreenAlert({ ...ALERT, botId: "" })?.botId).toBeUndefined();
  });
});
