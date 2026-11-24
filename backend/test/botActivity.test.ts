import { expect, test } from "bun:test";
import { startBotActivity, updateBotActivity } from "../convex/lib/botActivity";

test("activity pages advance the sequence and carry a full snapshot under the same alert id", () => {
  const start = startBotActivity({
    action: "start", title: "Build", steps: ["Compile", "Test"], link: null, note: "Starting",
  }, "activity-id", 1);
  const step = updateBotActivity(start, { action: "step", step: "Test", note: null }, 2);
  const note = updateBotActivity(step, { action: "note", note: "Green" }, 3);
  const end = updateBotActivity(note, { action: "end", state: "done", note: null }, 4);
  expect([start, step, note, end].map((activity) => activity.sequence)).toEqual([1, 2, 3, 4]);
  expect([start, step, note, end].map((activity) => activity.alertId)).toEqual(Array(4).fill("activity-id"));
  expect(step.note).toBeNull();
  expect(end).toMatchObject({ state: "done", title: "Build", track: { currentStep: "Test" }, note: "Green" });
});
