import { describe, expect, test } from "bun:test";
import {
  botPublicId,
  deliveryBackoffMs,
  DELIVERY_MAX_ATTEMPTS,
  formatPairingCode,
  goneReason,
  isBotId,
  isQuestionId,
  PENDING_BOT_CAP,
  questionIdFromBytes,
  receiptState,
  snoozeReleaseStep,
  ALERT_STATUSES,
  DISMISS_KIND,
  tooManyPendingBots,
} from "./model";

describe("delivery backoff", () => {
  test("waits 1s, 4s, then 16s, and stops after the last attempt", () => {
    expect(deliveryBackoffMs(0)).toBeNull();
    expect(deliveryBackoffMs(1)).toBe(1_000);
    expect(deliveryBackoffMs(2)).toBe(4_000);
    expect(deliveryBackoffMs(3)).toBe(16_000);
    expect(deliveryBackoffMs(DELIVERY_MAX_ATTEMPTS)).toBeNull();
  });
});

describe("ids", () => {
  test("builds a public bot id with a five-digit suffix", () => {
    expect(botPublicId("sheldon", 23648)).toBe("sheldon-23648");
    expect(botPublicId("sheldon", 42)).toBe("sheldon-00042");
    expect(isBotId("sheldon-23648")).toBe(true);
    expect(isBotId("sheldon")).toBe(false);
  });

  test("builds a question id from bytes", () => {
    const bytes = [0x01, 0x48, 0x56, 0x37, 0x4b, 0x33, 0x4d, 0x32, 0x5a, 0, 1, 2, 3, 4, 5, 6];
    let index = 0;
    const id = questionIdFromBytes(() => {
      const byte = bytes[index];
      if (byte === undefined) throw new Error("missing byte");
      index += 1;
      return byte;
    });
    expect(isQuestionId(id)).toBe(true);
    expect(id).toHaveLength(18);
  });

  test("formats a six-digit pairing code", () => {
    expect(formatPairingCode(42)).toBe("000042");
    expect(formatPairingCode(236481)).toBe("236481");
  });
});

describe("pending bot cap", () => {
  test("allows fewer than the cap and rejects the next pending bot", () => {
    expect(tooManyPendingBots(PENDING_BOT_CAP - 1)).toBe(false);
    expect(tooManyPendingBots(PENDING_BOT_CAP)).toBe(true);
    expect(() => tooManyPendingBots(-1)).toThrow(/non-negative/);
  });
});

describe("snoozed status and dismiss push", () => {
  test("snoozed joins the old statuses", () => {
    expect(ALERT_STATUSES).toEqual(["scheduled", "pending", "answered", "cancelled", "snoozed"]);
    expect(DISMISS_KIND).toBe("dismiss");
  });
});

describe("receiptState", () => {
  test("no answer row means the phone is still sending", () => {
    expect(receiptState(null)).toBe("pending");
  });

  test("a stored answer is sent until the webhook takes it", () => {
    expect(receiptState({ deliveryStatus: "pending", deliveryAttempts: 0 })).toBe("sent");
    expect(receiptState({ deliveryStatus: "pending", deliveryAttempts: 1 })).toBe("sent");
    expect(receiptState({ deliveryStatus: "delivered", deliveryAttempts: 1 })).toBe("delivered");
    // The built-in Puck bot is delivered without an attempt.
    expect(receiptState({ deliveryStatus: "delivered", deliveryAttempts: 0 })).toBe("delivered");
  });

  test("a failed try, retrying or final, is failed", () => {
    expect(receiptState({ deliveryStatus: "pending", deliveryAttempts: 1, lastError: "webhook request failed" })).toBe(
      "failed",
    );
    expect(receiptState({ deliveryStatus: "pending", deliveryAttempts: 0, lastError: "x" })).toBe("sent");
    expect(receiptState({ deliveryStatus: "failed", deliveryAttempts: 4, lastError: null })).toBe("failed");
  });
});

describe("snoozeReleaseStep", () => {
  test("releases only the snooze that scheduled it", () => {
    expect(snoozeReleaseStep("snoozed", 1000, 1000)).toBe("pending");
    expect(snoozeReleaseStep("snoozed", 2000, 1000)).toBe("skip");
    expect(snoozeReleaseStep("snoozed", null, 1000)).toBe("skip");
    expect(snoozeReleaseStep("pending", 1000, 1000)).toBe("skip");
    expect(snoozeReleaseStep("answered", 1000, 1000)).toBe("skip");
    expect(snoozeReleaseStep("cancelled", 1000, 1000)).toBe("skip");
  });
});

describe("goneReason", () => {
  const live = { status: "pending" as const, expiresAt: null, answeredByClientName: null, ownClientName: "Pixel 7", now: 1000 };

  test("a waiting alert is not gone", () => {
    expect(goneReason(live)).toBeNull();
    expect(goneReason({ ...live, status: "snoozed" })).toBeNull();
    expect(goneReason({ ...live, expiresAt: 2000 })).toBeNull();
  });

  test("cancelled and expired", () => {
    expect(goneReason({ ...live, status: "cancelled" })).toBe("cancelled");
    expect(goneReason({ ...live, expiresAt: 1000 })).toBe("expired");
    expect(goneReason({ ...live, expiresAt: 999 })).toBe("expired");
  });

  test("answered on another client, but not on this one or an unknown one", () => {
    expect(goneReason({ ...live, status: "answered", answeredByClientName: "MacBook" })).toBe("answeredElsewhere");
    expect(goneReason({ ...live, status: "answered", answeredByClientName: "Pixel 7" })).toBeNull();
    expect(goneReason({ ...live, status: "answered", answeredByClientName: null })).toBeNull();
    expect(goneReason({ ...live, status: "answered", answeredByClientName: "MacBook", ownClientName: null })).toBe(
      "answeredElsewhere",
    );
  });
});
