import { describe, expect, test } from "bun:test";
import {
  approvePairingBlock,
  approvePairingError,
  countsTowardPendingCap,
  isOpenRequestFor,
  pairingStatusOf,
} from "../convex/lib/pairingRules";
import { PAIRING_KIND } from "@puck/shared";
import { fcmPairingMessage } from "../convex/lib/fcm";

const NOW = 1_000_000;
const open = { pairingState: "pending" as const, pairingCodeExpiresAt: NOW + 60_000, userId: "user_1" };

describe("pairingStatusOf", () => {
  test("a pending request before its expiry is pending", () => {
    expect(pairingStatusOf(open, NOW)).toBe("pending");
  });

  test("a request past its expiry is expired, and one with no expiry too", () => {
    expect(pairingStatusOf({ ...open, pairingCodeExpiresAt: NOW - 1 }, NOW)).toBe("expired");
    expect(pairingStatusOf({ pairingState: "pending" }, NOW)).toBe("expired");
  });

  test("an approved bot is paired", () => {
    expect(pairingStatusOf({ ...open, pairingState: "paired" }, NOW)).toBe("paired");
  });

  test("a rejected request is rejected, even after it would have expired", () => {
    expect(pairingStatusOf({ ...open, rejectedAt: NOW - 5, pairingCodeExpiresAt: NOW - 100 }, NOW)).toBe("rejected");
  });
});

describe("isOpenRequestFor", () => {
  test("only the owner sees an open request", () => {
    expect(isOpenRequestFor(open, "user_1", NOW)).toBe(true);
    expect(isOpenRequestFor(open, "user_2", NOW)).toBe(false);
  });

  test("a rejected, expired or approved request is not open", () => {
    expect(isOpenRequestFor({ ...open, rejectedAt: NOW }, "user_1", NOW)).toBe(false);
    expect(isOpenRequestFor({ ...open, pairingCodeExpiresAt: NOW - 1 }, "user_1", NOW)).toBe(false);
    expect(isOpenRequestFor({ ...open, pairingState: "paired" }, "user_1", NOW)).toBe(false);
  });
});

describe("approvePairingBlock", () => {
  const pairedNoOwner = { pairingState: "paired" as const, pairingCodeExpiresAt: NOW + 60_000 };

  test("pending unsigned requests can be approved and gain an owner", () => {
    const unsigned = { pairingState: "pending" as const, pairingCodeExpiresAt: NOW + 60_000 };
    expect(approvePairingBlock(unsigned, "user_1", NOW)).toEqual({ kind: "ok_pending" });
  });

  test("pending signed-in requests reject a different owner", () => {
    expect(approvePairingBlock(open, "user_2", NOW)).toEqual({ kind: "wrong_owner" });
  });

  test("an expired pending code is expired", () => {
    expect(approvePairingBlock({ ...open, pairingCodeExpiresAt: NOW - 1 }, "user_1", NOW)).toEqual({
      kind: "expired",
    });
  });

  test("a paired bot with no owner can be adopted on retry", () => {
    expect(approvePairingBlock(pairedNoOwner, "user_1", NOW)).toEqual({ kind: "adopt_paired" });
  });

  test("a paired bot that already has an owner reads as already used", () => {
    expect(approvePairingBlock({ ...pairedNoOwner, userId: "user_1" }, "user_1", NOW)).toEqual({
      kind: "already_used",
    });
  });

  test("errors are plain sentences", () => {
    expect(approvePairingError({ kind: "already_used" })).toBe("pairing code was already used");
    expect(approvePairingError({ kind: "expired" })).toBe("pairing code has expired");
  });
});

describe("countsTowardPendingCap", () => {
  test("rejected requests free their slot", () => {
    expect(countsTowardPendingCap({ pairingState: "pending" })).toBe(true);
    expect(countsTowardPendingCap({ pairingState: "pending", rejectedAt: NOW })).toBe(false);
    expect(countsTowardPendingCap({ pairingState: "paired" })).toBe(false);
  });
});

describe("fcmPairingMessage", () => {
  test("is data-only, high priority, and carries the bot id without the code", () => {
    const body = fcmPairingMessage({
      pushToken: "token-aaaaaaaaaaaaaaaaaaaa",
      botId: "cortana-12345",
      botName: "cortana",
      colour: "indigo",
      addedFrom: "mac",
    });
    expect(body.message.token).toBe("token-aaaaaaaaaaaaaaaaaaaa");
    expect(body.message.data).toEqual({
      kind: PAIRING_KIND,
      botId: "cortana-12345",
      botName: "cortana",
      colour: "indigo",
      addedFrom: "mac",
    });
    expect("notification" in body.message).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/\d{6}/);
  });

  test("leaves colour and addedFrom out when the request has none", () => {
    const body = fcmPairingMessage({
      pushToken: "token-aaaaaaaaaaaaaaaaaaaa",
      botId: "cortana-12345",
      botName: "cortana",
      colour: null,
      addedFrom: null,
    });
    expect(Object.keys(body.message.data).sort()).toEqual(["botId", "botName", "kind"]);
  });
});
