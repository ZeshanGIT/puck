/**
 * Reminders for an unanswered urgent alert: after the ringtone has played once, the alert rings
 * again every few minutes (the person's choice, per bot) until it is answered, snoozed or
 * dismissed. Pure, so it can be unit-tested without React Native.
 */

/** An alert reminds at most this many times, which is about an hour at the default interval. */
export const MAX_REMINDERS = 12;

/** The times (epoch milliseconds) at which an alert that began at `from` reminds. None when off. */
export function reminderTimes(from: number, minutes: number): number[] {
  if (!Number.isFinite(minutes) || minutes <= 0) return [];
  return Array.from({ length: MAX_REMINDERS }, (_, index) => from + (index + 1) * minutes * 60_000);
}

/** The notification id of one reminder (1 is the first). */
export function reminderId(questionId: string, number: number): string {
  return `${questionId}~remind-${number}`;
}

/** Every reminder id an alert can have, so all of them can be cancelled. */
export function allReminderIds(questionId: string): string[] {
  return Array.from({ length: MAX_REMINDERS }, (_, index) => reminderId(questionId, index + 1));
}
