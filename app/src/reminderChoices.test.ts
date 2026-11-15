import { describe, expect, test } from "bun:test";
import { BOT_REMINDER_CHIPS, REMINDER_CHIPS, reminderChange, reminderChoice, reminderLabel } from "./reminderChoices";

describe("reminder chips", () => {
  test("labels", () => {
    expect(reminderLabel(0)).toBe("Off");
    expect(reminderLabel(5)).toBe("5 min");
    expect(REMINDER_CHIPS.map((chip) => chip.label)).toEqual(["Off", "2 min", "5 min", "10 min", "15 min"]);
  });

  test("a bot's page also offers Follow app settings, first", () => {
    expect(BOT_REMINDER_CHIPS[0]).toEqual({ id: "default", label: "Follow app settings" });
    expect(BOT_REMINDER_CHIPS).toHaveLength(REMINDER_CHIPS.length + 1);
  });

  test("a bot with no override follows app settings; that choice stores nothing, a minute count stores itself", () => {
    expect(reminderChoice(undefined)).toBe("default");
    expect(reminderChoice({ dnd: "all" })).toBe("default");
    expect(reminderChoice({ reminderMinutes: 0 })).toBe(0);
    expect(reminderChange("default")).toBeNull();
    expect(reminderChange(10)).toBe(10);
  });
});
