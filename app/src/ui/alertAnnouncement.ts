/** The words a screen reader speaks for a new alert. Plain TypeScript, no React Native. */

export interface AnnouncedAlert {
  botName: string;
  question: string;
  priority?: "normal" | "urgent";
}

/** "Urgent. Sheldon asks: Ship the 0.3 build tonight?" (one alert), or a count with the newest one. */
export function alertAnnouncement(fresh: readonly AnnouncedAlert[], waiting: number = fresh.length): string {
  const newest = fresh[fresh.length - 1];
  if (!newest) return "";
  const lead = newest.priority === "urgent" ? "Urgent. " : "";
  const asks = `${lead}${newest.botName} asks: ${newest.question}`;
  return waiting > 1 ? `${waiting} alerts waiting. Newest, ${asks}` : asks;
}
