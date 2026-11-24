import { expect, test } from "bun:test";
import { checkMachine, runMachine } from "@puck/shared";
import { desktopMachines } from "./machines";
import { floatingCard } from "./floatingCardMachine";

test("the desktop machine registry satisfies its invariants", () => {
  for (const machine of desktopMachines) expect(checkMachine(machine)).toEqual([]);
});

test("live arrivals wait behind a reply and answered or snoozed alerts leave the queue", () => {
  const states = runMachine(floatingCard, [
    { type: "snapshot", pending: ["old"], eligible: [] },
    { type: "snapshot", pending: ["old", "a"], eligible: ["a"] },
    { type: "snapshot", pending: ["old", "a", "b", "c"], eligible: ["b", "c"] },
    { type: "dismiss", questionId: "a" },
    { type: "snapshot", pending: ["old", "a", "c"], eligible: [] },
    { type: "snapshot", pending: ["old", "a", "b", "c"], eligible: ["b"] },
    { type: "hide" },
    { type: "snapshot", pending: ["old", "a", "b", "c"], eligible: [] },
  ]);
  expect(states.map((state) => state.queue)).toEqual([
    [], ["a"], ["a", "b", "c"], ["b", "c"], ["c"], ["c", "b"], [], [],
  ]);
});
