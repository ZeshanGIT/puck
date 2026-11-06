import { isoUtc, type AnswerChoice, type AnswerPayload, type AnswerSource, type Priority, type SnoozedPayload } from "./model";

/** Build the webhook JSON. `answeredAt` is epoch milliseconds and is written as ISO UTC. */
export function buildAnswerPayload(input: {
  questionId: string;
  question: string;
  bot: string;
  routine: string;
  priority: Priority;
  answers: AnswerChoice[];
  customReply: string | null;
  answeredAt: number;
  source: AnswerSource;
  /** Name of the client that answered, when known. */
  client?: string | null;
}): AnswerPayload {
  return {
    questionId: input.questionId,
    question: input.question,
    bot: input.bot,
    routine: input.routine,
    priority: input.priority,
    answers: input.answers.map((answer) => ({ id: answer.id, label: answer.label })),
    customReply: input.customReply,
    answeredAt: isoUtc(input.answeredAt),
    source: input.source,
    event: "answer",
    ...(input.client ? { client: input.client } : {}),
  };
}

/** Build the snoozed webhook JSON. `snoozedUntil` is epoch milliseconds, or null for "until I'm back". */
export function buildSnoozedPayload(input: {
  questionId: string;
  question: string;
  bot: string;
  routine: string;
  priority: Priority;
  snoozedUntil: number | null;
  client?: string | null;
}): SnoozedPayload {
  return {
    event: "snoozed",
    questionId: input.questionId,
    question: input.question,
    bot: input.bot,
    routine: input.routine,
    priority: input.priority,
    snoozedUntil: input.snoozedUntil === null ? null : isoUtc(input.snoozedUntil),
    ...(input.client ? { client: input.client } : {}),
  };
}
