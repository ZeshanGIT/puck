import { describe, expect, test } from "bun:test";
import {
  SNOOZE_CHOICES,
  answerSummary,
  attachmentSummary,
  clockLabel,
  goneCopy,
  receiptCloseDelayMs,
  receiptLine,
  receiptViewState,
  snoozeSheetText,
  snoozeUntil,
} from "./receiptCopy";

describe("receiptLine", () => {
  test("uses the prototype words", () => {
    expect(receiptLine("sending", "Sheldon").text).toBe("Sending…");
    expect(receiptLine("sent", "Sheldon")).toEqual({ text: "Sent", tone: "plain", icon: "check" });
    expect(receiptLine("delivered", "Sheldon")).toEqual({ text: "Delivered to Sheldon", tone: "ok", icon: "check" });
    expect(receiptLine("queued", "Sheldon").text).toBe("Waiting for network. It'll send by itself.");
  });

  test("a failed delivery is gentle", () => {
    expect(receiptLine("failed", "Sheldon")).toEqual({
      text: "Couldn't reach Sheldon. Puck will keep trying.",
      tone: "warn",
      icon: "warn",
    });
  });
});

describe("receiptCloseDelayMs", () => {
  test("closes about 1.5 s after delivery and waits while sending or sent", () => {
    expect(receiptCloseDelayMs("delivered")).toBe(1500);
    expect(receiptCloseDelayMs("sending")).toBeNull();
    expect(receiptCloseDelayMs("sent")).toBeNull();
    expect(receiptCloseDelayMs("failed")).not.toBeNull();
    expect(receiptCloseDelayMs("queued")).not.toBeNull();
  });
});

describe("receiptViewState", () => {
  test("queued wins over everything", () => {
    expect(receiptViewState({ queued: true, server: "delivered", sentLocally: true })).toBe("queued");
  });

  test("the server's view wins once it has one", () => {
    expect(receiptViewState({ queued: false, server: "delivered", sentLocally: true })).toBe("delivered");
    expect(receiptViewState({ queued: false, server: "failed", sentLocally: true })).toBe("failed");
    expect(receiptViewState({ queued: false, server: "sent", sentLocally: false })).toBe("sent");
  });

  test("with no server view it is sending until the send call returns", () => {
    expect(receiptViewState({ queued: false, server: undefined, sentLocally: false })).toBe("sending");
    expect(receiptViewState({ queued: false, server: null, sentLocally: false })).toBe("sending");
    expect(receiptViewState({ queued: false, server: "pending", sentLocally: false })).toBe("sending");
    expect(receiptViewState({ queued: false, server: "pending", sentLocally: true })).toBe("sent");
  });
});

describe("summaries", () => {
  test("answers and attachments", () => {
    expect(answerSummary(["Ship it"])).toBe("Ship it");
    expect(answerSummary(["Ship it", "Skip"])).toBe("Ship it, Skip");
    expect(attachmentSummary(undefined)).toBeNull();
    expect(attachmentSummary([])).toBeNull();
    expect(
      attachmentSummary([
        { type: "photo", name: "IMG_1.jpg" },
        { type: "file", name: "report.pdf" },
      ]),
    ).toBe("+ a photo, report.pdf");
  });
});

describe("goneCopy", () => {
  test("cancelled", () => {
    expect(goneCopy({ reason: "cancelled", botName: "Sheldon" })).toEqual({
      title: "Sheldon cancelled this",
      sub: "They got what they needed in chat.",
    });
  });

  test("expired names the time", () => {
    const at = new Date(2026, 10, 6, 9, 40).getTime();
    expect(clockLabel(at)).toBe("9:40");
    expect(goneCopy({ reason: "expired", botName: "Sheldon", expiredAt: at })).toEqual({
      title: "Expired at 9:40",
      sub: null,
    });
    expect(goneCopy({ reason: "expired", botName: "Sheldon" }).title).toBe("Expired");
  });

  test("answered elsewhere names the client and the choice", () => {
    expect(
      goneCopy({ reason: "answeredElsewhere", botName: "Sheldon", clientName: "MacBook", answerLabels: ["Ship it"] }),
    ).toEqual({ title: "Answered on MacBook", sub: "You chose “Ship it” there." });
    expect(goneCopy({ reason: "answeredElsewhere", botName: "Sheldon" })).toEqual({
      title: "Answered on another device",
      sub: null,
    });
  });
});

describe("snooze", () => {
  test("has the three prototype choices", () => {
    expect(SNOOZE_CHOICES.map((choice) => choice.label)).toEqual(["5 minutes", "10 minutes", "Until I'm back"]);
    expect(SNOOZE_CHOICES[2]?.detail).toBe("No reminder");
  });

  test("a timed choice is now plus its minutes, until I'm back is null", () => {
    const now = 1_700_000_000_000;
    expect(snoozeUntil(SNOOZE_CHOICES[0]!, now)).toBe(now + 5 * 60_000);
    expect(snoozeUntil(SNOOZE_CHOICES[1]!, now)).toBe(now + 10 * 60_000);
    expect(snoozeUntil(SNOOZE_CHOICES[2]!, now)).toBeNull();
  });

  test("the sheet text names the bot", () => {
    expect(snoozeSheetText("Sheldon")).toBe("It waits under Waiting. Sheldon will know you snoozed.");
  });
});
