import { describe, expect, test } from "bun:test";
import { pickAlertExtras, storedOption } from "../convex/lib/alertFields";

describe("pickAlertExtras", () => {
  test("keeps only the set optional fields", () => {
    const picked = pickAlertExtras({
      message: "Deploy window",
      details: undefined,
      link: { label: "Open", url: "https://example.com" },
      expiresAt: 2_000_000_000_000,
      speak: false,
      requiresUnlock: undefined,
    });
    expect(picked).toEqual({
      message: "Deploy window",
      link: { label: "Open", url: "https://example.com" },
      expiresAt: 2_000_000_000_000,
      speak: false,
    });
    expect(Object.keys(picked).sort()).toEqual(["expiresAt", "link", "message", "speak"]);
  });

  test("returns an empty object for a v0 alert", () => {
    expect(pickAlertExtras({})).toEqual({});
  });

  test("ignores fields that are not alert extras", () => {
    const picked = pickAlertExtras({ message: "hi", question: "not copied" } as Parameters<typeof pickAlertExtras>[0]);
    expect(picked).toEqual({ message: "hi" });
  });
});

describe("storedOption", () => {
  test("keeps the v0 fields and drops an undefined icon", () => {
    expect(storedOption({ id: "ship", label: "Ship it", icon: undefined })).toEqual({ id: "ship", label: "Ship it" });
    expect(Object.keys(storedOption({ id: "ship", label: "Ship it", icon: undefined }))).not.toContain("icon");
  });

  test("keeps the new option fields", () => {
    expect(
      storedOption({ id: "drop", label: "Drop table", desc: "Cannot be undone", tone: "destructive", rec: false, icon: "trash" }),
    ).toEqual({ id: "drop", label: "Drop table", desc: "Cannot be undone", tone: "destructive", rec: false, icon: "trash" });
  });
});
