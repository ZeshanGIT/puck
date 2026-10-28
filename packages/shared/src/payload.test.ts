import { describe, expect, test } from "bun:test";
import { buildAnswerPayload } from "./payload";

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
    ]);
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
