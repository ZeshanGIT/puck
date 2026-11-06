/** Next time the local clock reads `HH:MM`. A time already passed today is tomorrow. */
export function nextClockTime(text: string, now: number): number {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(text.trim());
  if (!match) throw new Error("time must be HH:MM");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("time must be HH:MM");
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}
