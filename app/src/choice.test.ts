import { describe, expect, test } from "bun:test";
import { emptyChoice, replyPayload, tapOption, toggleAll } from "./choice";

describe("tapOption", () => {
  test("the second tap on the same option confirms it", () => {
    const armed = tapOption(emptyChoice, "single", "ship");
    expect(armed.confirmId).toBeNull();
    expect(armed.state.armedId).toBe("ship");
    const confirmed = tapOption(armed.state, "single", "ship");
    expect(confirmed.confirmId).toBe("ship");
    const moved = tapOption(armed.state, "single", "hold");
    expect(moved.confirmId).toBeNull();
    expect(moved.state.armedId).toBe("hold");
  });

  test("multi toggles without confirming", () => {
    const first = tapOption(emptyChoice, "multi", "ship");
    const second = tapOption(first.state, "multi", "hold");
    const removed = tapOption(second.state, "multi", "ship");
    expect(second.confirmId).toBeNull();
    expect(removed.state.selectedIds).toEqual(["hold"]);
  });
});

describe("toggleAll", () => {
  test("selects every option, then clears them", () => {
    const selected = toggleAll(emptyChoice, ["ship", "hold"]);
    expect(selected.selectedIds).toEqual(["ship", "hold"]);
    expect(toggleAll(selected, ["ship", "hold"]).selectedIds).toEqual([]);
  });
});

describe("replyPayload", () => {
  test("a confirmed option can include typed text", () => {
    expect(
      replyPayload({ mode: "single", state: emptyChoice, confirmId: "ship", customReply: " after lunch " }),
    ).toEqual({ optionIds: ["ship"], customReply: "after lunch" });
  });

  test("an empty reply is rejected", () => {
    expect(() => replyPayload({ mode: "multi", state: emptyChoice, confirmId: null, customReply: "  " })).toThrow(
      "choose an option or send a custom reply",
    );
  });
});
