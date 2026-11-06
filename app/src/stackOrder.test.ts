import { describe, expect, test } from "bun:test";
import { nextUnansweredSlot, orderStack, peekSlots, stackCaption, stepSlot } from "./stackOrder";

type A = { id: string; priority: "normal" | "urgent"; createdAt: number };
const alert = (id: string, priority: A["priority"], createdAt: number): A => ({ id, priority, createdAt });

describe("orderStack", () => {
  test("urgent first, then the oldest first", () => {
    const input = [alert("ship", "normal", 200), alert("tidy", "normal", 100), alert("errors", "urgent", 300)];
    expect(orderStack(input).map((a) => a.id)).toEqual(["errors", "tidy", "ship"]);
  });

  test("older urgent alerts come before newer urgent ones", () => {
    const input = [alert("b", "urgent", 20), alert("a", "urgent", 10), alert("n", "normal", 1)];
    expect(orderStack(input).map((a) => a.id)).toEqual(["a", "b", "n"]);
  });

  test("ties keep the order they came in", () => {
    const input = [alert("x", "normal", 5), alert("y", "normal", 5), alert("z", "normal", 5)];
    expect(orderStack(input).map((a) => a.id)).toEqual(["x", "y", "z"]);
  });

  test("returns a new array and leaves the input alone", () => {
    const input = [alert("b", "normal", 2), alert("a", "normal", 1)];
    const out = orderStack(input);
    expect(out).not.toBe(input);
    expect(input.map((a) => a.id)).toEqual(["b", "a"]);
    expect(orderStack([])).toEqual([]);
  });
});

describe("stepSlot", () => {
  test("moves forward and back, wrapping round the ring", () => {
    expect(stepSlot(0, 1, 4)).toBe(1);
    expect(stepSlot(3, 1, 4)).toBe(0);
    expect(stepSlot(0, -1, 4)).toBe(3);
    expect(stepSlot(2, -1, 4)).toBe(1);
  });

  test("stays put with nothing to move to", () => {
    expect(stepSlot(0, 1, 1)).toBe(0);
    expect(stepSlot(0, -1, 1)).toBe(0);
    expect(stepSlot(0, 1, 0)).toBe(0);
  });
});

describe("nextUnansweredSlot", () => {
  test("finds the next unanswered card after the current one, wrapping round", () => {
    expect(nextUnansweredSlot([false, true, false], 0)).toBe(2);
    expect(nextUnansweredSlot([false, true, false], 2)).toBe(0);
    expect(nextUnansweredSlot([true, false, true], 2)).toBe(1);
  });

  test("goes to the summary slot when everything is answered", () => {
    expect(nextUnansweredSlot([true, true, true], 1)).toBe(3);
    expect(nextUnansweredSlot([], 0)).toBe(0);
  });

  test("the current card is the last candidate, so it is chosen when it is the only one left", () => {
    expect(nextUnansweredSlot([false, true, true], 0)).toBe(0);
  });
});

describe("peekSlots", () => {
  test("the next two cards peek, nearest first", () => {
    expect(peekSlots(0, 4, true)).toEqual([1, 2]);
    expect(peekSlots(1, 4, true)).toEqual([2, 3]);
  });

  test("the summary slot has no colour, so it is skipped and the card after it peeks first", () => {
    // Three alerts and a summary, on the last alert: summary is next, then the first alert.
    expect(peekSlots(2, 3, true)).toEqual([0]);
    expect(peekSlots(1, 3, true)).toEqual([2]);
  });

  test("on the summary the first two alerts peek", () => {
    expect(peekSlots(3, 3, true)).toEqual([0, 1]);
  });

  test("never peeks the front card itself", () => {
    expect(peekSlots(0, 1, true)).toEqual([]);
    expect(peekSlots(0, 2, false)).toEqual([1]);
    expect(peekSlots(0, 0, true)).toEqual([]);
  });
});

describe("stackCaption", () => {
  test("says how many are answered", () => {
    expect(stackCaption(0, 3)).toBe("0 of 3 answered · swipe to switch");
    expect(stackCaption(2, 3)).toBe("2 of 3 answered · swipe to switch");
  });
});
