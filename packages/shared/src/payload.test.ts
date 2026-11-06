import { describe, expect, test } from "bun:test";
import { buildAnswerPayload, buildSnoozedPayload } from "./payload";

describe("buildAnswerPayload", () => {
  test("matches the v0 spec sample", () => {
    const payload = buildAnswerPayload({
      questionId: "q_01HV7K3M2Z",
      question: "Ship the 0.3 build tonight?",
      bot: "Puck",
      routine: "Puck answer-back",
      priority: "urgent",
      answers: [{ id: "ship", label: "Ship it" }],
      customReply: "Ship it, but skip the changelog email",
      answeredAt: Date.parse("2026-10-28T16:00:00Z"),
      source: "app",
    });
    expect(payload).toEqual({
      questionId: "q_01HV7K3M2Z",
      question: "Ship the 0.3 build tonight?",
      bot: "Puck",
      routine: "Puck answer-back",
      priority: "urgent",
      answers: [{ id: "ship", label: "Ship it" }],
      customReply: "Ship it, but skip the changelog email",
      answeredAt: "2026-10-28T16:00:00.000Z",
      source: "app",
      event: "answer",
    });
    expect(Object.keys(payload)).toEqual([
      "questionId",
      "question",
      "bot",
      "routine",
      "priority",
      "answers",
      "customReply",
      "answeredAt",
      "source",
      "event",
    ]);
  });

  test("names the client that answered, only when known", () => {
    const base = {
      questionId: "q_01HV7K3M2Z",
      question: "Up yet?",
      bot: "sheldon",
      routine: "sheldon",
      priority: "normal" as const,
      answers: [{ id: "yes", label: "Yes" }],
      customReply: null,
      answeredAt: Date.parse("2026-10-28T16:00:00Z"),
      source: "app" as const,
    };
    expect(buildAnswerPayload({ ...base, client: "Pixel 7" }).client).toBe("Pixel 7");
    expect("client" in buildAnswerPayload({ ...base, client: null })).toBe(false);
    expect("client" in buildAnswerPayload(base)).toBe(false);
  });

  test("sends null when there is no custom reply", () => {
    const payload = buildAnswerPayload({
      questionId: "q_01HV7K3M2Z",
      question: "Up yet?",
      bot: "sheldon",
      routine: "sheldon",
      priority: "normal",
      answers: [{ id: "yes", label: "Yes" }],
      customReply: null,
      answeredAt: Date.parse("2026-10-28T16:00:00Z"),
      source: "app",
    });
    expect(payload.customReply).toBeNull();
  });
});

describe("buildSnoozedPayload", () => {
  const base = {
    questionId: "q_01HV7K3M2Z",
    question: "Up yet?",
    bot: "sheldon",
    routine: "wake-up",
    priority: "urgent" as const,
  };

  test("a timed snooze carries ISO UTC and no answers", () => {
    const payload = buildSnoozedPayload({
      ...base,
      snoozedUntil: Date.parse("2026-11-06T06:10:00Z"),
      client: "Pixel 7",
    });
    expect(payload).toEqual({
      event: "snoozed",
      ...base,
      snoozedUntil: "2026-11-06T06:10:00.000Z",
      client: "Pixel 7",
    });
    expect("answers" in payload).toBe(false);
  });

  test("until I'm back is null, and a missing client is left out", () => {
    const payload = buildSnoozedPayload({ ...base, snoozedUntil: null });
    expect(payload.snoozedUntil).toBeNull();
    expect("client" in payload).toBe(false);
  });
});
