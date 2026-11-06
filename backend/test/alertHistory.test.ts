import { describe, expect, test } from "bun:test";
import { buildTimeline, historyOutcome, isWaiting, type TimelineInput } from "../convex/lib/alertHistory";

const NOW = 10_000;

describe("historyOutcome", () => {
  test("answered and cancelled are final, whatever the expiry", () => {
    expect(historyOutcome({ status: "answered", expiresAt: 1 }, NOW)).toBe("answered");
    expect(historyOutcome({ status: "answered", expiresAt: null }, NOW)).toBe("answered");
    expect(historyOutcome({ status: "cancelled", expiresAt: null }, NOW)).toBe("cancelled");
  });

  test("a pending or snoozed alert past its expiry is missed, at the expiry instant too", () => {
    expect(historyOutcome({ status: "pending", expiresAt: NOW - 1 }, NOW)).toBe("missed");
    expect(historyOutcome({ status: "pending", expiresAt: NOW }, NOW)).toBe("missed");
    expect(historyOutcome({ status: "snoozed", expiresAt: NOW - 1 }, NOW)).toBe("missed");
  });

  test("open alerts inside their expiry, or with none, are not history", () => {
    expect(historyOutcome({ status: "pending", expiresAt: NOW + 1 }, NOW)).toBeNull();
    expect(historyOutcome({ status: "pending", expiresAt: null }, NOW)).toBeNull();
    expect(historyOutcome({ status: "snoozed", expiresAt: null }, NOW)).toBeNull();
    expect(historyOutcome({ status: "snoozed", expiresAt: NOW + 1 }, NOW)).toBeNull();
  });

  test("a scheduled alert is never history yet, even with a past expiry", () => {
    expect(historyOutcome({ status: "scheduled", expiresAt: NOW - 1 }, NOW)).toBeNull();
    expect(historyOutcome({ status: "scheduled", expiresAt: null }, NOW)).toBeNull();
  });
});

describe("isWaiting", () => {
  test("pending and snoozed alerts inside their expiry wait on him", () => {
    expect(isWaiting("pending", null, NOW)).toBe(true);
    expect(isWaiting("snoozed", NOW + 5, NOW)).toBe(true);
  });

  test("expired, scheduled and finished alerts do not", () => {
    expect(isWaiting("pending", NOW, NOW)).toBe(false);
    expect(isWaiting("snoozed", NOW - 1, NOW)).toBe(false);
    expect(isWaiting("scheduled", null, NOW)).toBe(false);
    expect(isWaiting("answered", null, NOW)).toBe(false);
    expect(isWaiting("cancelled", null, NOW)).toBe(false);
  });
});

function base(overrides: Partial<TimelineInput> = {}): TimelineInput {
  return {
    botName: "Sheldon",
    createdAt: 1_000,
    status: "answered",
    expiresAt: null,
    updatedAt: 1_000,
    answer: null,
    snoozes: [],
    ...overrides,
  };
}

const answered = (overrides: Partial<NonNullable<TimelineInput["answer"]>> = {}) => ({
  answeredAt: 5_000,
  answeredByClientName: "Pixel 7",
  deliveryStatus: "delivered" as const,
  deliveryAttempts: 1,
  lastError: null,
  ...overrides,
});

describe("buildTimeline", () => {
  test("orders sent, snooze, answer and delivery oldest first", () => {
    const timeline = buildTimeline(
      base({
        answer: answered({ answeredAt: 5_000 }),
        snoozes: [
          { snoozedAt: 3_000, snoozedUntil: null },
          { snoozedAt: 2_000, snoozedUntil: 4_000 },
        ],
      }),
      NOW,
    );
    expect(timeline.map((event) => event.kind)).toEqual(["created", "snoozed", "snoozed", "answered", "delivered"]);
    const times = timeline.map((event) => event.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test("names the client that answered and the bot that got the reply", () => {
    const timeline = buildTimeline(base({ answer: answered() }), NOW);
    expect(timeline.find((event) => event.kind === "answered")?.text).toBe("Answered on Pixel 7");
    expect(timeline.find((event) => event.kind === "delivered")?.text).toBe("Delivered to Sheldon");
  });

  test("a failed receipt shows as failed, and a sent-but-not-yet-failed one shows no delivery event", () => {
    const failed = buildTimeline(
      base({ answer: answered({ deliveryStatus: "pending", deliveryAttempts: 2, lastError: "webhook responded HTTP 500" }) }),
      NOW,
    );
    expect(failed.map((event) => event.kind)).toEqual(["created", "answered", "failed"]);
    expect(failed.find((event) => event.kind === "failed")?.text).not.toContain("HTTP 500");

    const sent = buildTimeline(base({ answer: answered({ deliveryStatus: "pending", deliveryAttempts: 1 }) }), NOW);
    expect(sent.map((event) => event.kind)).toEqual(["created", "answered"]);
  });

  test("a delivered answer with no client name says just Answered", () => {
    const timeline = buildTimeline(base({ answer: answered({ answeredByClientName: null }) }), NOW);
    expect(timeline.find((event) => event.kind === "answered")?.text).toBe("Answered");
  });

  test("a cancelled alert ends at its last update", () => {
    const timeline = buildTimeline(base({ status: "cancelled", updatedAt: 7_000 }), NOW);
    expect(timeline.map((event) => [event.kind, event.at])).toEqual([
      ["created", 1_000],
      ["cancelled", 7_000],
    ]);
  });

  test("a missed alert ends at its expiry", () => {
    const timeline = buildTimeline(
      base({ status: "pending", expiresAt: 8_000, updatedAt: 1_000 }),
      NOW,
    );
    expect(timeline.map((event) => [event.kind, event.at])).toEqual([
      ["created", 1_000],
      ["missed", 8_000],
    ]);
  });

  test("a delivered event uses the time the bot took it, not the answer time", () => {
    const timeline = buildTimeline(
      base({ answer: answered({ answeredAt: 2_000, deliveredAt: 6_000 }) }),
      NOW,
    );
    expect(timeline.map((event) => [event.kind, event.at])).toEqual([
      ["created", 1_000],
      ["answered", 2_000],
      ["delivered", 6_000],
    ]);
  });

  test("a delivered event falls back to the answer time when deliveredAt is missing", () => {
    const timeline = buildTimeline(base({ answer: answered({ answeredAt: 2_000, deliveredAt: null }) }), NOW);
    expect(timeline.find((event) => event.kind === "delivered")?.at).toBe(2_000);
  });

  test("answer and delivery at the same instant keep answer first", () => {
    const timeline = buildTimeline(base({ answer: answered({ answeredAt: 2_000 }) }), NOW);
    expect(timeline.slice(-2).map((event) => event.kind)).toEqual(["answered", "delivered"]);
  });
});
