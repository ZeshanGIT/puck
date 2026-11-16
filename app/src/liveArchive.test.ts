import { describe, expect, test } from "bun:test";
import { archiveGroups, clockWithSeconds, durationLabel, liveArchiveRow, liveTimeline, stepsNotReached, type ArchivedLive } from "./liveArchive";

const T0 = new Date(2026, 10, 16, 11, 22, 5).getTime();

const done: ArchivedLive = {
  activityId: "a1",
  botId: "mac-79521",
  botName: "mac",
  colour: null,
  title: "Release 0.4.0",
  steps: ["Fetch", "Build", "Test"],
  state: "done",
  startedAt: T0,
  endedAt: T0 + 45_000,
  history: [
    { step: "Fetch", at: T0 },
    { step: "Build", at: T0 + 15_000 },
    { step: "Test", at: T0 + 30_000 },
  ],
};

describe("durationLabel", () => {
  test("seconds, minutes, hours", () => {
    expect(durationLabel(45_000)).toBe("45 s");
    expect(durationLabel(3 * 60_000)).toBe("3 min");
    expect(durationLabel(65 * 60_000)).toBe("1 h 5 min");
    expect(durationLabel(120 * 60_000)).toBe("2 h");
  });
});

describe("liveArchiveRow", () => {
  test("how it ended, how many steps, how long, and when", () => {
    expect(liveArchiveRow(done)).toMatchObject({ detail: "Done · 3 steps · 45 s", tone: "ok", icon: "check", at: T0 + 45_000 });
    expect(liveArchiveRow({ ...done, state: "failed" })).toMatchObject({ detail: "Failed · 3 steps · 45 s", tone: "bad" });
    expect(liveArchiveRow({ ...done, state: "stale", history: [] }).detail).toBe("Stopped · 45 s");
  });
});

describe("liveTimeline", () => {
  test("Started, each step with its time and how long it ran, then how it ended", () => {
    expect(liveTimeline(done)).toEqual([
      { label: "Started", time: clockWithSeconds(T0), took: null, kind: "start", tone: "neutral" },
      { label: "Fetch", time: "11:22:05", took: "15 s", kind: "step", tone: "neutral" },
      { label: "Build", time: "11:22:20", took: "15 s", kind: "step", tone: "neutral" },
      { label: "Test", time: "11:22:35", took: "15 s", kind: "step", tone: "neutral" },
      { label: "Done", time: "11:22:50", took: null, kind: "end", tone: "ok" },
    ]);
  });
});

describe("stepsNotReached", () => {
  test("the given steps a failed task never got to, in order", () => {
    const failed = { ...done, state: "failed" as const, steps: ["Fetch", "Build", "Test", "Upload"], history: done.history.slice(0, 2) };
    expect(stepsNotReached(failed)).toEqual(["Test", "Upload"]);
    expect(stepsNotReached({ ...done, steps: null })).toEqual([]);
  });
});

describe("archiveGroups", () => {
  test("alerts and tasks interleave by time; tasks older than the loaded alerts wait for Load more", () => {
    const alert = (questionId: string, at: number) => ({
      questionId,
      question: "Q?",
      botName: "mac",
      outcome: "answered" as const,
      picks: ["Yes"],
      customReply: null,
      hasAttachments: false,
      answeredAt: at,
      answeredByClientName: null,
      deliveryStatus: "delivered" as const,
      createdAt: at - 1000,
    });
    const task = (activityId: string, endedAt: number) => ({ ...done, activityId, startedAt: endedAt - 1000, endedAt });
    const now = T0 + 3_600_000;
    const history = [alert("q_new", T0 + 3000), alert("q_old", T0 + 1000)];
    const live = [task("t_mid", T0 + 2000), task("t_older", T0 - 5000)];
    const order = (groups: ReturnType<typeof archiveGroups>) =>
      groups.flatMap((group) => group.entries.map((entry) => (entry.kind === "alert" ? entry.row.questionId : entry.row.activityId)));
    expect(order(archiveGroups(history, live, true, now))).toEqual(["q_new", "t_mid", "q_old"]);
    expect(order(archiveGroups(history, live, false, now))).toEqual(["q_new", "t_mid", "q_old", "t_older"]);
  });
});
