import { describe, expect, test } from "bun:test";
import { plainText, speechText } from "./speak";

describe("plainText", () => {
  test("drops the rich-text markup and keeps the words", () => {
    expect(plainText("**Flight** to *Delhi* at __10:40__, `gate 4`")).toBe("Flight to Delhi at 10:40, gate 4");
  });

  test("collapses line breaks and spaces", () => {
    expect(plainText("Leave by 8.\n\nPack   the charger.")).toBe("Leave by 8. Pack the charger.");
  });
});

describe("speechText", () => {
  test("reads the question as a sentence, then the message", () => {
    expect(speechText("Time to get up", "Flight to Delhi at **10:40**. Leave by 8.")).toBe(
      "Time to get up. Flight to Delhi at 10:40. Leave by 8.",
    );
  });

  test("does not double the punctuation of a question", () => {
    expect(speechText("Ship it?", "All checks passed.")).toBe("Ship it? All checks passed.");
    expect(speechText("Wake up!", undefined)).toBe("Wake up!");
  });

  test("a missing or empty message leaves just the question", () => {
    expect(speechText("Deploy now", undefined)).toBe("Deploy now.");
    expect(speechText("Deploy now", "")).toBe("Deploy now.");
    expect(speechText("Deploy now", "  \n ")).toBe("Deploy now.");
  });
});
