import type { LiveCommand } from "./live";
import type { CreateAlertInput } from "./model";
import { AlertValidationError, validateAlertTiming, validateCreateAlert } from "./validate";

export type BotAlert = CreateAlertInput & { replyTo?: string };
export type BotPage = { to: string } & ({ alert: BotAlert } | { activity: LiveCommand });

export function validateBotAlert(input: unknown, now: number): BotAlert {
  const alert = validateCreateAlert(input);
  const raw = input as Record<string, unknown>;
  if (alert.scheduledFor !== null) throw new AlertValidationError("scheduledFor cannot be used with --to");
  if (raw.snoozedUntil !== undefined || raw.snoozeUntil !== undefined) {
    throw new AlertValidationError("snooze fields cannot be used with --to");
  }
  validateAlertTiming(alert, now);
  const { replyTo } = raw;
  if (replyTo === undefined) return alert;
  if (typeof replyTo !== "string" || !replyTo.trim() || replyTo.length > 2048 || /[\u0000-\u001f\u007f]/.test(replyTo)) {
    throw new AlertValidationError("replyTo must be a non-empty string of at most 2048 characters on one line");
  }
  return { ...alert, replyTo };
}
