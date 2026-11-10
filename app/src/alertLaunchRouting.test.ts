import { describe, expect, test } from "bun:test";
import { acceptInitialOpen, alertLaunchSettled, inboxShowsHome, pickDeckAlert } from "./alertLaunchRouting";

const alerts = [
  { questionId: "q_AAA", botId: "a" },
  { questionId: "q_BBB", botId: "b" },
];

describe("pickDeckAlert", () => {
  test("with a launch id, only that alert is chosen", () => {
    expect(pickDeckAlert(alerts, "q_BBB")?.questionId).toBe("q_BBB");
    expect(pickDeckAlert(alerts, "q_MISSING")).toBeNull();
  });

  test("without a launch id, the first live alert wins", () => {
    expect(pickDeckAlert(alerts, null)?.questionId).toBe("q_AAA");
  });

  test("does not fall back to another alert when the launch id is missing", () => {
    expect(pickDeckAlert(alerts, "q_MISSING")).toBeNull();
  });
});

describe("alertLaunchSettled", () => {
  test("waits while the launched id is still loading", () => {
    expect(alertLaunchSettled("q_AAA", undefined, undefined, null)).toBe(false);
  });

  test("waits until the deck is showing the launched alert", () => {
    expect(alertLaunchSettled("q_AAA", alerts, alerts, null)).toBe(false);
    expect(alertLaunchSettled("q_AAA", alerts, alerts, "q_AAA")).toBe(true);
  });

  test("settles when the alert is no longer pending", () => {
    expect(alertLaunchSettled("q_GONE", [], [], null)).toBe(true);
  });
});

describe("inboxShowsHome", () => {
  test("never shows Home while waiting for a launch", () => {
    expect(inboxShowsHome({ deckAlert: null, launchId: "q_AAA", pending: alerts, visible: alerts })).toBe(
      false,
    );
  });

  test("shows Home when there is no launch and no alert", () => {
    expect(inboxShowsHome({ deckAlert: null, launchId: null, pending: [], visible: [] })).toBe(true);
  });
});

describe("initial open arbitration", () => {
  test("ignores an old lookup after a card tap", () => {
    expect(acceptInitialOpen(0, 1)).toBe(false);
  });
  test("ignores a lookup started after an existing open", () => {
    expect(acceptInitialOpen(1, 1)).toBe(false);
  });
  test("accepts the first uncontested lookup", () => {
    expect(acceptInitialOpen(0, 0)).toBe(true);
  });
});
