import { describe, expect, test } from "bun:test";
import { nextClockTime } from "./time";

describe("nextClockTime", () => {
  const now = new Date(2026, 9, 30, 2, 35, 12, 0).getTime();

  test("uses today when the clock time is still ahead", () => {
    expect(nextClockTime("06:00", now)).toBe(new Date(2026, 9, 30, 6, 0, 0, 0).getTime());
    expect(nextClockTime("6:05", now)).toBe(new Date(2026, 9, 30, 6, 5, 0, 0).getTime());
  });

  test("uses tomorrow when that time has passed", () => {
    expect(nextClockTime("02:00", now)).toBe(new Date(2026, 9, 31, 2, 0, 0, 0).getTime());
    expect(nextClockTime("02:35", now)).toBe(new Date(2026, 9, 31, 2, 35, 0, 0).getTime());
  });

  test("rejects a time that is not a clock", () => {
    expect(() => nextClockTime("25:00", now)).toThrow(/HH:MM/);
    expect(() => nextClockTime("6", now)).toThrow(/HH:MM/);
    expect(() => nextClockTime("noon", now)).toThrow(/HH:MM/);
  });
});
