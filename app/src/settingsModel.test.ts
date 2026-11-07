import { describe, expect, test } from "bun:test";
import {
  backendName,
  checkClientName,
  clientHealth,
  clientRows,
  healthChecks,
  healthRowValue,
  healthTitle,
  lastSeenText,
  otherClientCount,
  problemCount,
  pushRow,
  registeredText,
  selectedRingChip,
  testPageLine,
  testPageStatus,
  versionText,
  CLIENT_NAME_MAX,
  type ClientItem,
  type HealthSnapshot,
} from "./settingsModel";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date(2026, 10, 7, 14, 30).getTime();

const good: HealthSnapshot = {
  notifications: true,
  fullScreen: true,
  dndAccess: true,
  dndNeeded: true,
  registered: true,
  pushToken: true,
  online: true,
};

function client(over: Partial<ClientItem> & { id: string }): ClientItem {
  return { name: over.id, platform: "android", lastSeenAt: NOW, createdAt: NOW - 5 * HOUR, ...over };
}

describe("healthChecks", () => {
  test("all good: six ok rows, no fixes, 'Puck can reach you'", () => {
    const checks = healthChecks(good);
    expect(checks.map((check) => check.id)).toEqual(["notifications", "fullScreen", "dnd", "registered", "push", "network"]);
    expect(checks.every((check) => check.state === "ok" && check.fix === undefined)).toBe(true);
    expect(healthTitle(checks)).toBe("Puck can reach you");
    expect(healthRowValue(good)).toEqual({ text: "All good", tone: "ok" });
  });

  test("each failing state names its fix", () => {
    const by = (over: Partial<HealthSnapshot>) => healthChecks({ ...good, ...over });
    expect(by({ notifications: false })[0]).toMatchObject({ state: "bad", fix: { id: "notifications", label: "Turn on" } });
    expect(by({ fullScreen: false })[1]).toMatchObject({ state: "bad", fix: { id: "fullScreen", label: "Allow" } });
    expect(by({ dndAccess: false })[2]).toMatchObject({ state: "bad", fix: { id: "dnd", label: "Allow" } });
    expect(by({ registered: false })[3]).toMatchObject({ state: "bad", fix: { id: "signIn" } });
    expect(by({ pushToken: false })[4]).toMatchObject({ state: "bad", fix: { id: "push" } });
    expect(by({ online: false })[5]).toMatchObject({ state: "bad" });
    expect(by({ online: false })[5]?.fix).toBeUndefined();
  });

  test("Do Not Disturb access is only a problem while a bypass setting is on", () => {
    const off = healthChecks({ ...good, dndAccess: false, dndNeeded: false })[2];
    expect(off).toMatchObject({ state: "ok" });
    expect(off?.fix).toBeUndefined();
    expect(healthChecks({ ...good, dndAccess: false, dndNeeded: true })[2]?.state).toBe("bad");
  });

  test("push waits for notifications: no fix button while they are off", () => {
    const push = healthChecks({ ...good, notifications: false, pushToken: false })[4];
    expect(push?.state).toBe("bad");
    expect(push?.fix).toBeUndefined();
    expect(push?.detail).toContain("notifications");
  });

  test("unknown is neither a problem nor a fix", () => {
    const checks = healthChecks({ ...good, dndAccess: null, pushToken: null, registered: null });
    expect(checks.filter((check) => check.state === "unknown").map((check) => check.id)).toEqual(["dnd", "registered", "push"]);
    expect(problemCount(checks)).toBe(0);
    expect(checks.every((check) => check.fix === undefined)).toBe(true);
  });

  test("the headline counts the problems", () => {
    expect(healthTitle(healthChecks({ ...good, fullScreen: false }))).toBe("One thing needs you");
    expect(healthTitle(healthChecks({ ...good, fullScreen: false, notifications: false, online: false }))).toBe(
      "3 things need you",
    );
    expect(healthRowValue({ ...good, fullScreen: false })).toEqual({ text: "Needs you", tone: "warn" });
    expect(healthRowValue(undefined)).toBeNull();
  });
});

describe("clientHealth", () => {
  const list = [client({ id: "a", hasPushToken: true }), client({ id: "b", hasPushToken: false })];

  test("registered when the row is on the account, push from its token flag", () => {
    expect(clientHealth(list, "a")).toEqual({ registered: true, pushToken: true });
    expect(clientHealth(list, "b")).toEqual({ registered: true, pushToken: false });
  });

  test("a missing row is not registered; no client id is not registered; a loading list is unknown", () => {
    expect(clientHealth(list, "zzz")).toEqual({ registered: false, pushToken: false });
    expect(clientHealth(list, null)).toEqual({ registered: false, pushToken: false });
    expect(clientHealth(undefined, "a")).toEqual({ registered: null, pushToken: null });
  });

  test("a backend that does not report tokens leaves push unknown", () => {
    expect(clientHealth([client({ id: "a" })], "a")).toEqual({ registered: true, pushToken: null });
  });
});

describe("clients", () => {
  test("lastSeenText steps from just now to days", () => {
    expect(lastSeenText(NOW - 10_000, NOW)).toBe("Just now");
    expect(lastSeenText(NOW - 4 * MINUTE, NOW)).toBe("4 min ago");
    expect(lastSeenText(NOW - 3 * HOUR, NOW)).toBe("3 h ago");
    expect(lastSeenText(NOW - 50 * HOUR, NOW)).toBe("2 d ago");
    expect(lastSeenText(NOW + HOUR, NOW)).toBe("Just now");
  });

  test("registeredText: today, yesterday, then the date", () => {
    expect(registeredText(new Date(2026, 10, 7, 0, 5).getTime(), NOW)).toBe("Today");
    expect(registeredText(new Date(2026, 10, 6, 23, 55).getTime(), NOW)).toBe("Yesterday");
    expect(registeredText(new Date(2026, 9, 28, 12, 0).getTime(), NOW)).toBe("28 Oct 2026");
  });

  test("clientRows puts this phone first, then the most recently seen, and only others can be removed", () => {
    const rows = clientRows(
      [
        client({ id: "mac", name: "MacBook · CLI", platform: "cli", lastSeenAt: NOW - 4 * MINUTE }),
        client({ id: "old", name: "Old phone", lastSeenAt: NOW - 30 * HOUR }),
        client({ id: "me", name: "Pixel 7" }),
      ],
      "me",
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["me", "mac", "old"]);
    expect(rows[0]).toMatchObject({ isThis: true, subtitle: "This phone", removable: false });
    expect(rows[1]).toMatchObject({ isThis: false, subtitle: "Last seen 4 min ago", removable: true });
    expect(rows[2]?.subtitle).toBe("Last seen 1 d ago");
  });

  test("otherClientCount leaves this phone out and waits for the list", () => {
    expect(otherClientCount([client({ id: "me" }), client({ id: "x" })], "me")).toBe(1);
    expect(otherClientCount([client({ id: "me" })], "me")).toBe(0);
    expect(otherClientCount(undefined, "me")).toBeNull();
  });

  test("pushRow", () => {
    expect(pushRow(true)).toEqual({ text: "Connected", tone: "ok" });
    expect(pushRow(false).tone).toBe("warn");
    expect(pushRow(undefined).tone).toBe("neutral");
  });
});

describe("checkClientName", () => {
  test("trims a good name", () => {
    expect(checkClientName("  Pixel 7 ")).toEqual({ ok: true, name: "Pixel 7" });
  });

  test("rejects empty, too long, multi-line and taken names", () => {
    expect(checkClientName("   ").ok).toBe(false);
    expect(checkClientName("a".repeat(CLIENT_NAME_MAX + 1)).ok).toBe(false);
    expect(checkClientName("a".repeat(CLIENT_NAME_MAX)).ok).toBe(true);
    expect(checkClientName("two\nlines").ok).toBe(false);
    expect(checkClientName("MacBook", ["MacBook"]).ok).toBe(false);
    expect(checkClientName("📱".repeat(CLIENT_NAME_MAX)).ok).toBe(true);
  });
});

describe("test page", () => {
  const yes = { status: "answered", options: [{ id: "yes", chosen: true }, { id: "no", chosen: false }], answer: { answeredAt: 5 } };
  const no = { status: "answered", options: [{ id: "yes", chosen: false }, { id: "no", chosen: true }], answer: { answeredAt: 6 } };

  test("status follows the alert", () => {
    expect(testPageStatus(undefined)).toEqual({ kind: "waiting" });
    expect(testPageStatus(null)).toEqual({ kind: "waiting" });
    expect(testPageStatus({ status: "pending", options: [], answer: null })).toEqual({ kind: "waiting" });
    expect(testPageStatus(yes)).toEqual({ kind: "answered", heardYou: true, at: 5 });
    expect(testPageStatus(no)).toEqual({ kind: "answered", heardYou: false, at: 6 });
    expect(testPageStatus({ status: "cancelled", options: [], answer: null })).toEqual({ kind: "missed" });
  });

  test("the line under the button", () => {
    const time = (at: number) => `t${at}`;
    expect(testPageLine({ kind: "idle" }, time)).toBeNull();
    expect(testPageLine({ kind: "waiting" }, time)).toContain("Waiting");
    expect(testPageLine({ kind: "answered", heardYou: true, at: 5 }, time)).toBe("It works. You answered at t5.");
    expect(testPageLine({ kind: "answered", heardYou: false, at: 6 }, time)).toContain("Not really");
    expect(testPageLine({ kind: "error", message: "nope" }, time)).toBe("nope");
  });
});

describe("about", () => {
  test("versionText", () => {
    expect(versionText({ version: "1.0.0", build: "41", dev: true })).toEqual({ title: "Puck 1.0.0", build: "41 · debug" });
    expect(versionText({ version: "1.2.0", build: null, dev: false })).toEqual({ title: "Puck 1.2.0", build: "release" });
    expect(versionText({ version: undefined, build: undefined, dev: true }).title).toBe("Puck unknown");
  });

  test("backendName is the deployment name", () => {
    expect(backendName("https://usable-mule-44.convex.cloud")).toBe("usable-mule-44");
    expect(backendName("not a url")).toBe("not a url");
  });

  test("selectedRingChip", () => {
    expect(selectedRingChip(60)).toBe(60);
    expect(selectedRingChip(120)).toBe(120);
    expect(selectedRingChip(45)).toBeNull();
  });
});
