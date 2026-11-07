import { describe, expect, test } from "bun:test";
import { alertAnnouncement } from "./alertAnnouncement";

describe("alertAnnouncement", () => {
  test("one alert: who asks what", () => {
    expect(alertAnnouncement([{ botName: "Sheldon", question: "Ship it?" }])).toBe("Sheldon asks: Ship it?");
  });

  test("an urgent alert says so first", () => {
    expect(alertAnnouncement([{ botName: "Deploy Watch", question: "Roll back?", priority: "urgent" }])).toBe(
      "Urgent. Deploy Watch asks: Roll back?",
    );
  });

  test("a stack says how many are waiting and reads the newest", () => {
    const text = alertAnnouncement(
      [
        { botName: "Sheldon", question: "Ship it?" },
        { botName: "Brow", question: "Tidy up?" },
      ],
      3,
    );
    expect(text).toBe("3 alerts waiting. Newest, Brow asks: Tidy up?");
  });

  test("nothing new, nothing said", () => {
    expect(alertAnnouncement([])).toBe("");
  });
});
