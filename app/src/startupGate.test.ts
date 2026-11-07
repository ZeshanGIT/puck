import { describe, expect, test } from "bun:test";
import { inboxReady, openingVisible } from "./startupGate";

const base = { signingOut: false, inboxReady: false, timedOut: false } as const;

describe("openingVisible", () => {
  test("the opening gate and a sign-out always show it", () => {
    expect(openingVisible({ ...base, gate: "opening" })).toBe(true);
    expect(openingVisible({ ...base, gate: "inbox", signingOut: true, inboxReady: true })).toBe(true);
  });

  test("it stays up on the way into the inbox until the inbox has its data", () => {
    expect(openingVisible({ ...base, gate: "inbox" })).toBe(true);
    expect(openingVisible({ ...base, gate: "inbox", inboxReady: true })).toBe(false);
  });

  test("the safety timeout lets the inbox show without its data", () => {
    expect(openingVisible({ ...base, gate: "inbox", timedOut: true })).toBe(false);
  });

  test("onboarding screens (signed out or mid-setup) never wait for the inbox", () => {
    for (const gate of ["welcome", "permissions", "test", "first-bot"] as const) {
      expect(openingVisible({ ...base, gate })).toBe(false);
    }
  });
});

describe("inboxReady", () => {
  const loaded = { clientId: "c1", pending: [], bots: [], waiting: [], historyLoading: false };

  test("not until the client id and the pending alerts are known", () => {
    expect(inboxReady({ ...loaded, clientId: undefined })).toBe(false);
    expect(inboxReady({ ...loaded, pending: undefined })).toBe(false);
  });

  test("a registered phone also waits for bots, waiting alerts and the first page of history", () => {
    expect(inboxReady({ ...loaded, bots: undefined })).toBe(false);
    expect(inboxReady({ ...loaded, waiting: undefined })).toBe(false);
    expect(inboxReady({ ...loaded, historyLoading: true })).toBe(false);
    expect(inboxReady(loaded)).toBe(true);
  });

  test("the legacy phone with no client id needs only the pending alerts", () => {
    expect(inboxReady({ clientId: null, pending: [], bots: undefined, waiting: undefined, historyLoading: false })).toBe(true);
  });
});
