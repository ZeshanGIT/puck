import { describe, expect, test } from "bun:test";
import {
  botPublicId,
  deliveryBackoffMs,
  DELIVERY_MAX_ATTEMPTS,
  formatPairingCode,
  isBotId,
  isQuestionId,
  questionIdFromBytes,
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
