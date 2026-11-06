import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearOpenedPairing,
  openedPairingBotId,
  openPairingFromNotificationData,
  resetPairingOpen,
} from "./pairingOpen";
import {
  pairingBotIdFromNotificationData,
  pairingNotificationCopy,
  pairingNotificationId,
  pairingPush,
} from "./pairingPayload";

const PUSH = { kind: "pairing", botId: "cortana-00042", botName: "Cortana", colour: "indigo", addedFrom: "MacBook" };

describe("pairingPush", () => {
  test("reads Expo's dataString, a nested data object and a bare payload", () => {
    const expected = { botId: "cortana-00042", botName: "Cortana", colour: "indigo", addedFrom: "MacBook" };
    expect(pairingPush({ data: { dataString: JSON.stringify(PUSH) } })).toEqual(expected);
    expect(pairingPush({ data: PUSH })).toEqual(expected);
    expect(pairingPush(PUSH)).toEqual(expected);
  });

  test("colour and addedFrom are optional", () => {
    const { colour: _c, addedFrom: _a, ...bare } = PUSH;
    expect(pairingPush(bare)).toEqual({ botId: "cortana-00042", botName: "Cortana", colour: null, addedFrom: null });
    expect(pairingPush({ ...PUSH, colour: "chartreuse" })?.colour).toBeNull();
  });

  test("ignores other pushes and junk", () => {
    expect(pairingPush({ ...PUSH, kind: "dismiss" })).toBeNull();
    expect(pairingPush({ ...PUSH, botId: "nope" })).toBeNull();
    expect(pairingPush({ ...PUSH, botName: "  " })).toBeNull();
    expect(pairingPush({ data: { dataString: "{not json" } })).toBeNull();
    expect(pairingPush(null)).toBeNull();
    expect(pairingPush([])).toBeNull();
  });
});

describe("notification", () => {
  test("the shade copy has the name and the machine but no code", () => {
    const copy = pairingNotificationCopy({ botId: "cortana-00042", botName: "Cortana", colour: null, addedFrom: "MacBook" });
    expect(copy.title).toBe("Cortana wants to page you");
    expect(copy.body).toContain("MacBook");
    expect(copy.body).not.toMatch(/\d{3}/u);
    expect(pairingNotificationCopy({ botId: "cortana-00042", botName: "Cortana", colour: null, addedFrom: null }).body).toBe(
      "Tap to check the code and approve.",
    );
    expect(pairingNotificationId("cortana-00042")).toBe("pairing-cortana-00042");
  });

  test("a tap carries the bot id; other notifications carry none", () => {
    expect(pairingBotIdFromNotificationData({ kind: "pairing", botId: "cortana-00042" })).toBe("cortana-00042");
    expect(pairingBotIdFromNotificationData({ questionId: "q_BEXA0M8Y5W1ADYPX" })).toBeNull();
    expect(pairingBotIdFromNotificationData({ kind: "pairing", botId: "nope" })).toBeNull();
    expect(pairingBotIdFromNotificationData(undefined)).toBeNull();
  });
});

describe("opened pairing store", () => {
  beforeEach(resetPairingOpen);

  test("a tap is kept until the inbox takes it", () => {
    expect(openedPairingBotId()).toBeNull();
    expect(openPairingFromNotificationData({ kind: "pairing", botId: "cortana-00042" })).toBe(true);
    expect(openedPairingBotId()).toBe("cortana-00042");
    clearOpenedPairing();
    expect(openedPairingBotId()).toBeNull();
  });

  test("other notifications leave it alone", () => {
    expect(openPairingFromNotificationData({ questionId: "q_BEXA0M8Y5W1ADYPX" })).toBe(false);
    expect(openedPairingBotId()).toBeNull();
  });
});
