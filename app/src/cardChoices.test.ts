import { describe, expect, test } from "bun:test";
import { cardChoices } from "./cardChoices";

const option = (id: string, tone?: string) => ({ id, label: id.toUpperCase(), ...(tone ? { tone } : {}) });

describe("cardChoices", () => {
  test("up to four options, in order, with the risky one marked", () => {
    expect(cardChoices({ selectionMode: "single", options: [option("ship"), option("skip", "destructive")] })).toEqual([
      { id: "ship", label: "SHIP", risky: false, open: false },
      { id: "skip", label: "SKIP", risky: true, open: false },
    ]);
  });

  test("more than four: three, then More… which opens the alert", () => {
    const choices = cardChoices({ selectionMode: "single", options: ["a", "b", "c", "d", "e"].map((id) => option(id)) });
    expect(choices.map((choice) => choice.label)).toEqual(["A", "B", "C", "More…"]);
    expect(choices[3]!.open).toBe(true);
  });

  test("pick several, or no options at all: one way into the alert", () => {
    expect(cardChoices({ selectionMode: "multi", options: [option("a"), option("b")] })).toEqual([
      { id: "__open", label: "Pick several…", risky: false, open: true },
    ]);
    expect(cardChoices({ selectionMode: "single", options: [] })[0]!.label).toBe("Open");
  });
});
