/** Read the JSON accepted by targeted sends. */
export function readBotMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("message" in value) || Object.keys(value).length !== 1) {
    return null;
  }
  const message = typeof value.message === "string" ? value.message.trim() : "";
  return message.length > 0 && message.length <= 4000 ? message : null;
}

export const BOT_MESSAGE_INPUT_ERROR = 'expected JSON with one "message" string (1–4000 characters)';
