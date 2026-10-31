import { FULL_SCREEN_KIND, isQuestionId } from "@puck/shared";

export interface FullScreenAlert {
  questionId: string;
  question: string;
  botName: string;
}

/** Reads the data-only FCM payload, including the JSON string Expo hands the background task. */
export function fullscreenAlert(payload: unknown): FullScreenAlert | null {
  const data = notificationData(payload);
  if (!data || data.kind !== FULL_SCREEN_KIND) return null;
  const questionId = data.questionId;
  const question = data.question;
  const botName = data.botName;
  if (typeof questionId !== "string" || !isQuestionId(questionId)) return null;
  if (typeof question !== "string" || question.length === 0) return null;
  if (typeof botName !== "string" || botName.length === 0) return null;
  return { questionId, question, botName };
}

function notificationData(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  if (!record) return null;
  const nested = asRecord(record.data);
  const encoded = nested?.dataString;
  if (typeof encoded === "string") {
    try {
      return asRecord(JSON.parse(encoded));
    } catch {
      return null;
    }
  }
  if (nested && typeof nested.kind === "string") return nested;
  if (typeof record.kind === "string") return record;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
