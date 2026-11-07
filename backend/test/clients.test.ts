import { describe, expect, test } from "bun:test";
import {
  CLIENT_NAME_MAX,
  MAX_CLIENTS_PER_USER,
  UNAUTHORIZED,
  clerkSubject,
  decideRegistration,
  renameConflicts,
  toClientView,
  validateClientName,
} from "../convex/lib/clientRules";

const CLERK = "https://in-lemming-9901.clerk.accounts.dev";
const SITE = "https://usable-mule-44.convex.site";

describe("validateClientName", () => {
  test("trims and keeps a normal name", () => {
    expect(validateClientName("  Pixel 7 ")).toBe("Pixel 7");
  });

  test("rejects empty and blank names", () => {
    expect(validateClientName("")).toBeNull();
    expect(validateClientName("   ")).toBeNull();
  });

  test("allows 40 characters and rejects 41", () => {
    expect(validateClientName("a".repeat(CLIENT_NAME_MAX))).toBe("a".repeat(CLIENT_NAME_MAX));
    expect(validateClientName("a".repeat(CLIENT_NAME_MAX + 1))).toBeNull();
  });

  test("counts an emoji as one character", () => {
    expect(validateClientName("📱".repeat(CLIENT_NAME_MAX))).not.toBeNull();
  });

  test("rejects more than one line", () => {
    expect(validateClientName("Pixel\n7")).toBeNull();
    expect(validateClientName("Pixel\r7")).toBeNull();
    expect(validateClientName("Pixel\u20287")).toBeNull();
    expect(validateClientName("Pixel\t7")).toBeNull();
    expect(validateClientName("Pixel 7\n")).toBe("Pixel 7");
  });
});

describe("decideRegistration", () => {
  test("a new name creates", () => {
    expect(decideRegistration({ sameName: null, replace: false, clientCount: 0 })).toEqual({ action: "create" });
  });

  test("the same name without replace reports exists and the existing id", () => {
    expect(decideRegistration({ sameName: { id: "c1" }, replace: false, clientCount: 3 })).toEqual({
      action: "exists",
      clientId: "c1",
    });
  });

  test("the same name with replace keeps the id", () => {
    expect(decideRegistration({ sameName: { id: "c1" }, replace: true, clientCount: 3 })).toEqual({
      action: "replace",
      clientId: "c1",
    });
  });

  test("replace with no same-name client still creates", () => {
    expect(decideRegistration({ sameName: null, replace: true, clientCount: 1 })).toEqual({ action: "create" });
  });

  test("the cap blocks a new row at 10 and allows the 10th", () => {
    expect(decideRegistration({ sameName: null, replace: false, clientCount: MAX_CLIENTS_PER_USER - 1 })).toEqual({
      action: "create",
    });
    expect(decideRegistration({ sameName: null, replace: false, clientCount: MAX_CLIENTS_PER_USER })).toEqual({
      action: "full",
    });
  });

  test("a full list can still replace or report exists", () => {
    expect(decideRegistration({ sameName: { id: "c1" }, replace: true, clientCount: MAX_CLIENTS_PER_USER }).action).toBe(
      "replace",
    );
    expect(decideRegistration({ sameName: { id: "c1" }, replace: false, clientCount: MAX_CLIENTS_PER_USER }).action).toBe(
      "exists",
    );
  });
});

describe("renameConflicts", () => {
  test("another client with the name conflicts, the same client does not", () => {
    expect(renameConflicts("c1", { id: "c2" })).toBe(true);
    expect(renameConflicts("c1", { id: "c1" })).toBe(false);
    expect(renameConflicts("c1", null)).toBe(false);
  });
});

describe("clerkSubject", () => {
  test("returns the subject of a Clerk identity", () => {
    expect(clerkSubject({ subject: "user_abc", issuer: CLERK }, CLERK)).toBe("user_abc");
  });

  test("ignores a trailing slash on either issuer", () => {
    expect(clerkSubject({ subject: "user_abc", issuer: `${CLERK}/` }, CLERK)).toBe("user_abc");
    expect(clerkSubject({ subject: "user_abc", issuer: CLERK }, `${CLERK}/`)).toBe("user_abc");
  });

  test("rejects no identity and a missing subject", () => {
    expect(() => clerkSubject(null, CLERK)).toThrow(UNAUTHORIZED);
    expect(() => clerkSubject({ subject: "", issuer: CLERK }, CLERK)).toThrow(UNAUTHORIZED);
  });

  test("rejects the device JWT identity", () => {
    expect(() => clerkSubject({ subject: "dev_abc", issuer: SITE }, CLERK)).toThrow(UNAUTHORIZED);
  });

  test("rejects an identity with no issuer", () => {
    expect(() => clerkSubject({ subject: "user_abc" }, CLERK)).toThrow(UNAUTHORIZED);
  });
});

describe("toClientView", () => {
  const row = { _id: "c1", name: "Pixel 7", platform: "android" as const, lastSeenAt: 20, createdAt: 10 };

  test("says whether a push token is stored and never returns the token", () => {
    const withToken = toClientView({ ...row, pushToken: "fcm-secret-token" });
    expect(withToken.hasPushToken).toBe(true);
    expect(JSON.stringify(withToken)).not.toContain("fcm-secret-token");
    expect("pushToken" in withToken).toBe(false);
    expect(toClientView(row).hasPushToken).toBe(false);
    expect(toClientView({ ...row, pushToken: "" }).hasPushToken).toBe(false);
  });

  test("carries the flags only when they were recorded", () => {
    expect(toClientView(row)).toEqual({ id: "c1", name: "Pixel 7", platform: "android", hasPushToken: false, lastSeenAt: 20, createdAt: 10 });
    expect(toClientView({ ...row, fullScreenAllowed: false, dndAccess: true })).toMatchObject({
      fullScreenAllowed: false,
      dndAccess: true,
    });
  });
});
