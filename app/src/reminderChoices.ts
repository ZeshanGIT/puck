/**
 * The reminder chips: the global choices on Alert sounds, and a bot's own choice (which can also be
 * "Follow app settings") on its page. Pure, so it can be unit-tested.
 */
import { REMINDER_CHOICES, type BotBypass } from "./localSettings";

/** "Off", "2 min". */
export function reminderLabel(minutes: number): string {
  return minutes === 0 ? "Off" : `${minutes} min`;
}

export const REMINDER_CHIPS: readonly { minutes: number; label: string }[] = REMINDER_CHOICES.map((minutes) => ({
  minutes,
  label: reminderLabel(minutes),
}));

/** A bot's chip: its own choice, or "default" when it has none. */
export type ReminderChoice = "default" | number;

export const BOT_REMINDER_CHIPS: readonly { id: ReminderChoice; label: string }[] = [
  { id: "default", label: "Follow app settings" },
  ...REMINDER_CHIPS.map((chip) => ({ id: chip.minutes, label: chip.label })),
];

export function reminderChoice(bypass: BotBypass | undefined): ReminderChoice {
  return bypass?.reminderMinutes ?? "default";
}

/** What a bot's chip stores: minutes, or null to go back to the default. */
export function reminderChange(choice: ReminderChoice): number | null {
  return choice === "default" ? null : choice;
}
