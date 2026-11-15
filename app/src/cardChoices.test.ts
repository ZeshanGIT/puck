import { describe, expect, test } from "bun:test";
import { cardChoices, plainText } from "./cardChoices";

const option = (id: string, tone?: string) => ({ id, label: id.toUpperCase(), ...(tone ? { tone } : {}) });

describe("cardChoices", () => {
  test("up to four options, in order, with the risky one marked", () => {
    expect(cardChoices({ selectionMode: "single", options: [option("ship"), option("skip", "destructive")] })).toEqual([
      { id: "ship", label: "SHIP", desc: "", rec: false, risky: false, open: false },
      { id: "skip", label: "SKIP", desc: "", rec: false, risky: true, open: false },
    ]);
  });

  test("more than four: three, then More… which opens the alert", () => {
    const choices = cardChoices({ selectionMode: "single", options: ["a", "b", "c", "d", "e"].map((id) => option(id)) });
    expect(choices.map((choice) => choice.label)).toEqual(["A", "B", "C", "More…"]);
    expect(choices[3]!.open).toBe(true);
  });

  test("pick several, or no options at all: one way into the alert", () => {
    expect(cardChoices({ selectionMode: "multi", options: [option("a"), option("b")] })).toEqual([
      { id: "__open", label: "Pick several…", desc: "", rec: false, risky: false, open: true },
    ]);
    expect(cardChoices({ selectionMode: "single", options: [] })[0]!.label).toBe("Open");
  });
});

describe("descriptions and the recommended answer", () => {
  test("carry the description as plain text and the bot's recommendation", () => {
    const [ship] = cardChoices({
      selectionMode: "single",
      options: [{ id: "ship", label: "Ship it", rec: true, desc: "Builds `0.3.0 (41)` and posts it to the **beta** channel." }],
    });
    expect(ship).toMatchObject({ rec: true, desc: "Builds 0.3.0 (41) and posts it to the beta channel." });
  });

  test("plainText drops the light markdown and folds lines", () => {
    expect(plainText("I'll ship at *9 AM*\nand __remind__ you. See [notes](https://x.y).")).toBe("I'll ship at 9 AM and remind you. See notes.");
  });
});
