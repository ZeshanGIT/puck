import { FULL_SCREEN_KIND, isQuestionId } from "@puck/shared";

export interface FullScreenAlert {
  questionId: string;
  question: string;
  botName: string;
  /** The bot's public id (`sheldon-11019`), for its own Do Not Disturb and silent-mode overrides. Older pushes have none. */
  botId?: string;
  /** The alert's message, sent only with `speak` so the phone can read it aloud. */
  message?: string;
  ringSeconds?: number;
  speak?: boolean;
  bypassDnd?: boolean;
  bypassSilent?: boolean;
  requiresUnlock?: boolean;
}

/** Same bounds as `ringSeconds` validation on `POST /alerts`. */
const RING_SECONDS_MIN = 5;
const RING_SECONDS_MAX = 600;

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
  const alert: FullScreenAlert = { questionId, question, botName };
  // Optional: an older backend does not send it. Anything but a non-empty string is dropped.
  const botId = data.botId;
  if (typeof botId === "string" && botId.length > 0) alert.botId = botId;
  // FCM data values are strings, so flags arrive as "true" and numbers as "300". Older payloads
  // carry none of these and keep working.
  const message = data.alertMessage;
  if (typeof message === "string" && message.length > 0) alert.message = message;
  const ringSeconds = wireNumber(data.ringSeconds);
  if (ringSeconds !== undefined && ringSeconds >= RING_SECONDS_MIN && ringSeconds <= RING_SECONDS_MAX) {
    alert.ringSeconds = ringSeconds;
  }
  for (const flag of ["speak", "bypassDnd", "bypassSilent", "requiresUnlock"] as const) {
    const value = wireBoolean(data[flag]);
    if (value !== undefined) alert[flag] = value;
  }
  return alert;
}

function wireBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function wireNumber(value: unknown): number | undefined {
  const number = typeof value === "string" && /^\d{1,6}$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) ? number : undefined;
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
