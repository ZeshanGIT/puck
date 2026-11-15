import { describe, expect, test } from "bun:test";
import { REMINDER_CHIPS, reminderLabel } from "./reminderChoices";

describe("reminder chips", () => {
  test("labels", () => {
    expect(reminderLabel(0)).toBe("Off");
    expect(reminderLabel(5)).toBe("5 min");
    expect(REMINDER_CHIPS.map((chip) => chip.label)).toEqual(["Off", "2 min", "5 min", "10 min", "15 min"]);
  });
});
