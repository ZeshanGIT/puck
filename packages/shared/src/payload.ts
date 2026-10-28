import { isoUtc, type AnswerPayload, type AnswerSource, type Priority, type AnswerChoice } from "./model";

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
  };
}
