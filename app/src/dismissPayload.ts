import { DISMISS_KIND, isQuestionId } from "@puck/shared";

/**
 * Reads the data-only FCM push that tells this phone to drop an alert answered or snoozed on
 * another client (`{kind: "dismiss", questionId}`, built by `fcmDismissMessage` on the backend).
 * Same shapes as `fullscreenAlert` accepts, including the JSON string Expo hands the background
 * task. Returns the question id to clear with `clearDisplayedAlert`, or null for anything else.
 */
export function dismissedQuestionId(payload: unknown): string | null {
  const data = notificationData(payload);
  if (!data || data.kind !== DISMISS_KIND) return null;
  const questionId = data.questionId;
  return typeof questionId === "string" && isQuestionId(questionId) ? questionId : null;
}

/** The data object of a push, whichever shape it arrives in (Expo's `dataString`, nested `data`, or bare). */
export function notificationData(payload: unknown): Record<string, unknown> | null {
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
