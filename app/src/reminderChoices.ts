/**
 * The reminder chips under each kind of alert, on Alerts and on a bot's page. Pure, so it can be
 * unit-tested.
 */
import { REMINDER_CHOICES } from "./localSettings";

/** "Off", "2 min". */
export function reminderLabel(minutes: number): string {
  return minutes === 0 ? "Off" : `${minutes} min`;
}

export const REMINDER_CHIPS: readonly { minutes: number; label: string }[] = REMINDER_CHOICES.map((minutes) => ({
  minutes,
  label: reminderLabel(minutes),
}));
