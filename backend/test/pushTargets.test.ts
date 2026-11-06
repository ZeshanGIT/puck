import { describe, expect, test } from "bun:test";
import { alertIsForClient, pushSummary, selectPushTargets } from "../convex/lib/pushTargets";

const A = "token-aaaaaaaaaaaaaaaaaaaa";
const B = "token-bbbbbbbbbbbbbbbbbbbb";
const LEGACY = "token-legacylegacylegacy";

describe("selectPushTargets", () => {
  test("returns one target per client with a token", () => {
    const targets = selectPushTargets({
      clients: [
        { id: "c1", pushToken: A, fullScreenAllowed: true },
        { id: "c2", pushToken: B },
        { id: "c3" },
      ],
      device: null,
    });
    expect(targets).toEqual([
      { pushToken: A, fullScreenAllowed: true },
      { pushToken: B, fullScreenAllowed: false },
    ]);
  });

  test("a targetClientId narrows to that client", () => {
    const targets = selectPushTargets({
      clients: [
        { id: "c1", pushToken: A },
        { id: "c2", pushToken: B, fullScreenAllowed: true },
      ],
      device: { pushToken: LEGACY },
      targetClientId: "c2",
    });
    expect(targets).toEqual([{ pushToken: B, fullScreenAllowed: true }]);
  });

  test("a targetClientId with no token or no match gives no targets, and skips the legacy device", () => {
    expect(
      selectPushTargets({ clients: [{ id: "c1" }], device: { pushToken: LEGACY }, targetClientId: "c1" }),
    ).toEqual([]);
    expect(
      selectPushTargets({ clients: [{ id: "c1", pushToken: A }], device: { pushToken: LEGACY }, targetClientId: "nope" }),
    ).toEqual([]);
  });

  test("the legacy device is added when it has a token", () => {
    const targets = selectPushTargets({
      clients: [{ id: "c1", pushToken: A }],
      device: { pushToken: LEGACY, fullScreenAllowed: true },
    });
    expect(targets).toEqual([
      { pushToken: A, fullScreenAllowed: false },
      { pushToken: LEGACY, fullScreenAllowed: true },
    ]);
  });

  test("the legacy device is the only target when there are no clients", () => {
    expect(selectPushTargets({ clients: [], device: { pushToken: LEGACY } })).toEqual([
      { pushToken: LEGACY, fullScreenAllowed: false },
    ]);
  });

  test("equal tokens are listed once, and the client wins over the device", () => {
    const targets = selectPushTargets({
      clients: [
        { id: "c1", pushToken: A, fullScreenAllowed: true },
        { id: "c2", pushToken: A },
      ],
      device: { pushToken: A },
    });
    expect(targets).toEqual([{ pushToken: A, fullScreenAllowed: true }]);
  });

  test("no tokens anywhere gives no targets", () => {
    expect(selectPushTargets({ clients: [{ id: "c1" }], device: {} })).toEqual([]);
    expect(selectPushTargets({ clients: [], device: null })).toEqual([]);
  });

  test("an empty targetClientId is the same as none", () => {
    expect(selectPushTargets({ clients: [{ id: "c1", pushToken: A }], device: null, targetClientId: "" })).toHaveLength(1);
  });
});

describe("pushSummary", () => {
  test("states counts only", () => {
    expect(pushSummary(2, 2)).toBe("push sent to 2 of 2");
    expect(pushSummary(0, 1)).toBe("push sent to 0 of 1");
  });
});

describe("alertIsForClient", () => {
  test("untargeted alerts are for everyone", () => {
    expect(alertIsForClient(undefined, "c1")).toBe(true);
    expect(alertIsForClient(null, "c1")).toBe(true);
  });
  test("a targeted alert is only for its client", () => {
    expect(alertIsForClient("c1", "c1")).toBe(true);
    expect(alertIsForClient("c1", "c2")).toBe(false);
  });
});
