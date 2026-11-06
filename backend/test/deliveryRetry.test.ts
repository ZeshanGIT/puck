import { describe, expect, test } from "bun:test";
import { RETRY_MIN_GAP_MS, decideRetry } from "../convex/lib/deliveryRetry";

const NOW = 100_000;

describe("decideRetry", () => {
  test("a failed delivery with no earlier retry is retried", () => {
    expect(decideRetry({ deliveryStatus: "failed", lastRetryAt: null }, NOW)).toEqual({ action: "retry" });
  });

  test("a delivered answer is refused", () => {
    const decision = decideRetry({ deliveryStatus: "delivered", lastRetryAt: null }, NOW);
    expect(decision).toEqual({ action: "refuse", message: "answer was already delivered" });
  });

  test("a pending answer is refused, even one that has already failed a try", () => {
    const decision = decideRetry({ deliveryStatus: "pending", lastRetryAt: null }, NOW);
    expect(decision).toEqual({ action: "refuse", message: "answer delivery is already pending" });
  });

  test("a second retry inside 10 seconds is refused", () => {
    expect(decideRetry({ deliveryStatus: "failed", lastRetryAt: NOW - 5_000 }, NOW)).toEqual({
      action: "refuse",
      message: "retry too soon: wait 10 seconds between tries",
    });
    expect(decideRetry({ deliveryStatus: "failed", lastRetryAt: NOW - (RETRY_MIN_GAP_MS - 1) }, NOW).action).toBe(
      "refuse",
    );
  });

  test("exactly 10 seconds after the last retry is allowed", () => {
    expect(decideRetry({ deliveryStatus: "failed", lastRetryAt: NOW - RETRY_MIN_GAP_MS }, NOW)).toEqual({
      action: "retry",
    });
  });

  test("the gap is 10 seconds", () => {
    expect(RETRY_MIN_GAP_MS).toBe(10_000);
  });
});
