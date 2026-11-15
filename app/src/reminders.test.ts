import { describe, expect, test } from "bun:test";
import { allReminderIds, MAX_REMINDERS, reminderId, reminderTimes } from "./reminders";

describe("reminderTimes", () => {
  test("one reminder per interval after the alert, up to the limit", () => {
    const times = reminderTimes(1_000_000, 5);
    expect(times).toHaveLength(MAX_REMINDERS);
    expect(times[0]).toBe(1_000_000 + 5 * 60_000);
    expect(times[1]).toBe(1_000_000 + 10 * 60_000);
  });

  test("off, or a nonsense interval, means no reminders", () => {
    expect(reminderTimes(0, 0)).toEqual([]);
    expect(reminderTimes(0, -5)).toEqual([]);
    expect(reminderTimes(0, Number.NaN)).toEqual([]);
  });
});

describe("reminder ids", () => {
  test("each reminder has its own id, and all of them can be listed to cancel", () => {
    expect(reminderId("q_A", 1)).toBe("q_A~remind-1");
    const ids = allReminderIds("q_A");
    expect(ids).toHaveLength(MAX_REMINDERS);
    expect(new Set(ids).size).toBe(MAX_REMINDERS);
    expect(ids[0]).toBe(reminderId("q_A", 1));
  });
});
