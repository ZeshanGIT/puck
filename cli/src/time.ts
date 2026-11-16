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

/** A wait such as `90s`, `30m`, `2h` or `45` (seconds), in milliseconds. */
export function parseDuration(text: string): number {
  const match = /^(\d+)\s*(s|m|h)?$/u.exec(text.trim());
  if (!match) throw new Error("timeout must look like 90s, 30m or 2h");
  const amount = Number(match[1]);
  const unit = match[2] === "h" ? 3_600_000 : match[2] === "m" ? 60_000 : 1_000;
  const ms = amount * unit;
  if (ms < 1_000 || ms > 7 * 24 * 3_600_000) throw new Error("timeout must be between 1 second and 7 days");
  return ms;
}
