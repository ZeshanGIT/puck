import { describe, expect, test } from "bun:test";
import { expiryOf, expiryView, hasExpired, normalizeExpiry, snoozeOf } from "./alertExpiry";

const CREATED = Date.parse("2026-11-08T03:03:00.000Z");
/** 08:38 IST, the moment the reported alert was opened from Home. */
const OPENED_0838_IST = Date.parse("2026-11-08T03:08:00.000Z");
/** 08:39 IST: the snooze's wake time in the report (2026-11-08T03:09:13.130Z). */
const WAKE_0839_IST = Date.parse("2026-11-08T03:09:13.130Z");

describe("expiryOf", () => {
  test("only a real, positive time counts; null, missing, zero and junk mean no expiry", () => {
    expect(expiryOf(null)).toBeUndefined();
    expect(expiryOf(undefined)).toBeUndefined();
    expect(expiryOf(0)).toBeUndefined();
    expect(expiryOf(-5)).toBeUndefined();
    expect(expiryOf(Number.NaN)).toBeUndefined();
    expect(expiryOf(CREATED)).toBe(CREATED);
  });
});

describe("hasExpired", () => {
  test("a null expiry is never past (null used to read as 0, so every alert was Missed)", () => {
    expect(hasExpired(null, OPENED_0838_IST)).toBe(false);
    expect(hasExpired(null, 0)).toBe(false);
    expect(hasExpired(undefined, OPENED_0838_IST)).toBe(false);
  });

  test("a real expiry is past from its own time on", () => {
    expect(hasExpired(CREATED, CREATED - 1)).toBe(false);
    expect(hasExpired(CREATED, CREATED)).toBe(true);
  });
});

describe("snoozeOf", () => {
  test("only a snoozed alert has a snooze state; null wake time means until I'm back", () => {
    expect(snoozeOf({ status: "pending" })).toBeUndefined();
    expect(snoozeOf({})).toBeUndefined();
    expect(snoozeOf({ status: "snoozed", snoozedUntil: WAKE_0839_IST })).toEqual({ until: WAKE_0839_IST });
    expect(snoozeOf({ status: "snoozed", snoozedUntil: null })).toEqual({ until: null });
  });
});

describe("expiryView", () => {
  test("no expiry and not snoozed: no pill at all (no Missed)", () => {
    expect(expiryView({ expiresAt: null, createdAt: CREATED, opened: OPENED_0838_IST, now: OPENED_0838_IST })).toBeNull();
  });

  test("the reported case: snoozed, no expiry, opened before the wake time shows the snooze, not Missed", () => {
    const view = expiryView({
      expiresAt: null,
      createdAt: CREATED,
      opened: OPENED_0838_IST,
      now: OPENED_0838_IST,
      snooze: { until: WAKE_0839_IST },
    });
    expect(view).toMatchObject({ label: "Back in 2 min", expired: false, low: false, snoozed: true });
  });

  test("snoozed with a real expiry still in the future: the snooze note, and answers stay open", () => {
    const expiresAt = OPENED_0838_IST + 10 * 60_000;
    const view = expiryView({
      expiresAt,
      createdAt: CREATED,
      opened: OPENED_0838_IST,
      now: OPENED_0838_IST,
      snooze: { until: WAKE_0839_IST },
    });
    expect(view).toMatchObject({ label: "Back in 2 min", expired: false, snoozed: true });
  });

  test("snoozed with until-I'm-back: says so", () => {
    expect(
      expiryView({ expiresAt: null, opened: OPENED_0838_IST, now: OPENED_0838_IST, snooze: { until: null } }),
    ).toMatchObject({ label: "Snoozed until you're back", snoozed: true });
  });

  test("not snoozed, a real expiry in 10 minutes: the countdown", () => {
    const expiresAt = OPENED_0838_IST + 10 * 60_000;
    expect(expiryView({ expiresAt, createdAt: CREATED, opened: OPENED_0838_IST, now: OPENED_0838_IST })).toMatchObject({
      label: "10 min left",
      expired: false,
      snoozed: false,
    });
  });

  test("not snoozed, a real expiry passed: Missed, and answers are off", () => {
    const expiresAt = OPENED_0838_IST - 1000;
    expect(expiryView({ expiresAt, createdAt: CREATED, opened: OPENED_0838_IST, now: OPENED_0838_IST })).toMatchObject({
      label: "Missed",
      expired: true,
    });
  });

  test("snoozed past a real expiry: it is truly expired, so Missed (the server says the same)", () => {
    const expiresAt = OPENED_0838_IST - 1000;
    expect(
      expiryView({
        expiresAt,
        createdAt: CREATED,
        opened: OPENED_0838_IST,
        now: OPENED_0838_IST,
        snooze: { until: WAKE_0839_IST },
      }),
    ).toMatchObject({ label: "Missed", expired: true, snoozed: false });
  });
});

describe("normalizeExpiry", () => {
  test("a waiting alert from Convex with a null expiry has no expiresAt key, as the app's types expect", () => {
    const normalized = normalizeExpiry({ questionId: "q_HPH6J1HXDGP4W1JR", expiresAt: null, status: "snoozed" });
    expect(normalized).toEqual({ questionId: "q_HPH6J1HXDGP4W1JR", status: "snoozed" });
    expect("expiresAt" in normalized).toBe(false);
  });

  test("a real expiry is kept", () => {
    expect(normalizeExpiry({ expiresAt: CREATED })).toEqual({ expiresAt: CREATED });
  });
});
