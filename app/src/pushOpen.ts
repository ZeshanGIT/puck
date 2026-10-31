import { isQuestionId } from "@puck/shared";

/** Question id carried on the FCM notification the phone just opened. */
export function questionIdFromNotificationData(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const questionId = (data as { questionId?: unknown }).questionId;
  if (typeof questionId !== "string" || !isQuestionId(questionId)) return null;
  return questionId;
}
