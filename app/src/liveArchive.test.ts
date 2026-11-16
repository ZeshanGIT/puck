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

describe("notes in the Archive", () => {
  test("notes sit under their step with their own time; steps still count once and time to the next step", () => {
    const item: ArchivedLive = {
      ...done,
      steps: ["Test", "Upload"],
      endedAt: T0 + 40_000,
      history: [
        { step: "Test", at: T0, note: "starting" },
        { step: "Test", at: T0 + 10_000, note: "120 of 312" },
        { step: "Test", at: T0 + 20_000, note: "312 passed" },
        { step: "Upload", at: T0 + 30_000 },
      ],
    };
    expect(liveArchiveRow(item).detail).toBe("Done · 2 steps · 40 s");
    expect(liveTimeline(item).map((entry) => [entry.kind, entry.label, entry.took])).toEqual([
      ["start", "Started", null],
      ["step", "Test", "30 s"],
      ["note", "starting", null],
      ["note", "120 of 312", null],
      ["note", "312 passed", null],
      ["step", "Upload", "10 s"],
      ["end", "Done", null],
    ]);
  });

  test("a task with no steps: its title and every note, in order", () => {
    const item: ArchivedLive = {
      ...done,
      steps: null,
      history: [
        { step: "", at: T0, note: "0 of 10 files" },
        { step: "", at: T0 + 20_000, note: "10 of 10 files" },
      ],
    };
    expect(liveArchiveRow(item).detail).toBe("Done · 45 s");
    expect(liveTimeline(item).map((entry) => entry.label)).toEqual(["Started", "0 of 10 files", "10 of 10 files", "Done"]);
  });
});

describe("archiveFirstView", () => {
  test("today's entries, at most ten; anything else waits behind Show earlier", async () => {
    const { archiveFirstView } = await import("./liveArchive");
    const now = T0 + 3_600_000;
    const entry = (id: string, at: number) => ({ kind: "live" as const, item: done, row: { ...liveArchiveRow(done), activityId: id, at } });
    const today = Array.from({ length: 12 }, (_, i) => entry(`t${i}`, now - i * 1000));
    const many = archiveFirstView([{ label: "Today", entries: today }, { label: "Yesterday", entries: [entry("y", now - 86_400_000)] }], now);
    expect(many.groups[0]!.entries).toHaveLength(10);
    expect(many.hidden).toBe(true);
    const few = archiveFirstView([{ label: "Today", entries: today.slice(0, 3) }], now);
    expect(few).toMatchObject({ hidden: false });
    expect(few.groups[0]!.entries).toHaveLength(3);
    const none = archiveFirstView([{ label: "Yesterday", entries: [entry("y", now - 86_400_000)] }], now);
    expect(none).toEqual({ groups: [], hidden: true });
  });
});
