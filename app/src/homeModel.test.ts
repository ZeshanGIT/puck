import { describe, expect, test } from "bun:test";
import {
  BANNER_COPY,
  dayLabel,
  dndBypassActive,
  flockText,
  groupByDay,
  healthBanners,
  historyRow,
  isNoBotsYet,
  knownBots,
  needsTitle,
  needsYou,
  snoozeNote,
  goThroughLabel,
  stackableCount,
  type HistoryItem,
  type WaitingAlert,
} from "./homeModel";

const MIN = 60_000;
/** Friday 6 November 2026, 10:00 local. */
const NOW = new Date(2026, 10, 6, 10, 0).getTime();
const at = (day: number, hour: number, minute = 0, month = 10, year = 2026) =>
  new Date(year, month, day, hour, minute).getTime();

const waiting = (id: string, extra: Partial<WaitingAlert> = {}): WaitingAlert => ({
  questionId: id,
  question: `Question ${id}`,
  botId: `bot-${id}`,
  botName: `Bot ${id}`,
  priority: "normal",
  status: "pending",
  presentation: "choice",
  selectionMode: "single",
  snoozedUntil: null,
  expiresAt: null,
  createdAt: 1000,
  ...extra,
});

const item = (id: string, extra: Partial<HistoryItem> = {}): HistoryItem => ({
  questionId: id,
  question: `Question ${id}`,
  botName: "Sheldon",
  outcome: "answered",
  picks: ["Yes"],
  customReply: null,
  hasAttachments: false,
  answeredAt: at(6, 9, 12),
  answeredByClientName: "Pixel 7",
  deliveryStatus: "delivered",
  createdAt: at(6, 9, 10),
  ...extra,
});

describe("healthBanners", () => {
  test("none when nothing is wrong", () => {
    expect(healthBanners({ notificationsOff: false, fullScreenOff: false, dndOff: false, offline: false })).toEqual([]);
  });

  test("most serious first: notifications, lock screen, Do Not Disturb, offline", () => {
    expect(healthBanners({ notificationsOff: true, fullScreenOff: true, dndOff: true, offline: true })).toEqual([
      "notifications",
      "fullScreen",
      "dnd",
      "offline",
    ]);
    expect(healthBanners({ notificationsOff: false, fullScreenOff: true, dndOff: false, offline: true })).toEqual([
      "fullScreen",
      "offline",
    ]);
  });

  test("only offline has no fix button", () => {
    expect(BANNER_COPY.offline.action).toBeUndefined();
    expect(BANNER_COPY.notifications.action).toBe("Turn on");
    expect(BANNER_COPY.fullScreen.action).toBe("Allow");
  });
});

describe("dndBypassActive", () => {
  test("follows the global setting", () => {
    expect(dndBypassActive({ bypassDnd: "urgent", bots: {} })).toBe(true);
    expect(dndBypassActive({ bypassDnd: "all", bots: {} })).toBe(true);
    expect(dndBypassActive({ bypassDnd: "off", bots: {} })).toBe(false);
  });

  test("a bot override can turn it on while the global one is off", () => {
    expect(dndBypassActive({ bypassDnd: "off", bots: { a: { dnd: "urgent" } } })).toBe(true);
    expect(dndBypassActive({ bypassDnd: "off", bots: { a: { dnd: "off" }, b: { silent: "all" } } })).toBe(false);
  });
});

describe("snoozeNote", () => {
  test("minutes, rounded up, at least one", () => {
    expect(snoozeNote(NOW + 10 * MIN, NOW)).toBe("Back in 10 min");
    expect(snoozeNote(NOW + 4 * MIN + 1, NOW)).toBe("Back in 5 min");
    expect(snoozeNote(NOW - MIN, NOW)).toBe("Back in 1 min");
  });

  test("an hour or more is a clock time", () => {
    expect(snoozeNote(at(6, 14, 5), NOW)).toBe("Back at 14:05");
  });

  test("no time is until he is back", () => {
    expect(snoozeNote(null, NOW)).toBe("Snoozed until you're back");
  });
});

describe("needsYou", () => {
  const none = new Set<string>();

  test("pending before snoozed, urgent first, otherwise the order given", () => {
    const list = [
      waiting("s", { status: "snoozed", snoozedUntil: NOW + 10 * MIN }),
      waiting("a"),
      waiting("u", { priority: "urgent" }),
      waiting("b"),
    ];
    expect(needsYou(list, { now: NOW, queuedIds: none }).map((n) => n.questionId)).toEqual(["u", "a", "b", "s"]);
  });

  test("notes: unanswered, snoozed, and not sent yet in amber", () => {
    const [pending, queued, snoozed] = needsYou(
      [waiting("p"), waiting("s", { status: "snoozed", snoozedUntil: null }), waiting("q")],
      { now: NOW, queuedIds: new Set(["q"]) },
    ) as [ReturnType<typeof needsYou>[number], ReturnType<typeof needsYou>[number], ReturnType<typeof needsYou>[number]];
    expect(pending.note).toBe("Unanswered");
    expect(pending.noteWarn).toBe(false);
    expect(queued.note).toBe("Not sent yet");
    expect(queued.noteWarn).toBe(true);
    expect(snoozed.note).toBe("Snoozed until you're back");
  });

  test("a snoozed alert is never 'not sent yet'", () => {
    const [only] = needsYou([waiting("s", { status: "snoozed" })], { now: NOW, queuedIds: new Set(["s"]) });
    expect(only?.queued).toBe(false);
  });

  test("the title counts only with more than one", () => {
    expect(needsTitle(1)).toBe("Needs you");
    expect(needsTitle(3)).toBe("Needs you · 3");
  });

  test("the stack takes pending alerts that are not waiting on the phone", () => {
    const items = needsYou(
      [waiting("a"), waiting("b"), waiting("q"), waiting("s", { status: "snoozed", snoozedUntil: NOW + MIN })],
      { now: NOW, queuedIds: new Set(["q"]) },
    );
    expect(stackableCount(items)).toBe(2);
  });
});

describe("goThroughLabel", () => {
  test("the prototype's words when every card can be gone through", () => {
    expect(goThroughLabel(2, 2)).toBe("Go through all 2");
  });

  test("says how many are ready when some cards are snoozed or not sent", () => {
    expect(goThroughLabel(2, 4)).toBe("Go through the 2 ready now");
    expect(goThroughLabel(0, 1)).toBe("Go through the 0 ready now");
  });
});

describe("historyRow", () => {
  test("delivered is green with a tick", () => {
    expect(historyRow(item("1"))).toMatchObject({ detail: "You: Yes", tone: "ok", icon: "check", time: "9:12" });
  });

  test("failed delivery is red with a warning", () => {
    expect(historyRow(item("1", { deliveryStatus: "failed", picks: ["Draft it"] }))).toMatchObject({
      detail: "You: Draft it · Not delivered",
      tone: "bad",
      icon: "warn",
    });
  });

  test("still on its way has no tick", () => {
    expect(historyRow(item("1", { deliveryStatus: "pending" }))).toMatchObject({ tone: "neutral", icon: null });
    expect(historyRow(item("1", { deliveryStatus: null }))).toMatchObject({ tone: "neutral", icon: null });
  });

  test("several picks are joined; a reply with no picks shows the words", () => {
    expect(historyRow(item("1", { picks: ["Merge", "Tag it"] })).detail).toBe("You: Merge, Tag it");
    expect(historyRow(item("1", { picks: [], customReply: "Squash it" })).detail).toBe("You: “Squash it”");
    expect(historyRow(item("1", { picks: [], hasAttachments: true })).detail).toBe("You: a file");
  });

  test("missed and cancelled use the time the alert came in", () => {
    const missed = historyRow(item("1", { outcome: "missed", answeredAt: null, picks: [], deliveryStatus: null, createdAt: at(5, 14, 14) }));
    expect(missed).toMatchObject({ detail: "Missed", tone: "neutral", icon: null, time: "14:14" });
    expect(historyRow(item("1", { outcome: "cancelled", answeredAt: null })).detail).toBe("Cancelled");
  });
});

describe("dayLabel", () => {
  test("today and yesterday", () => {
    expect(dayLabel(at(6, 0, 1), NOW)).toBe("Today");
    expect(dayLabel(at(5, 23, 59), NOW)).toBe("Yesterday");
  });

  test("the weekday for the rest of the week, then the date", () => {
    expect(dayLabel(at(4, 12), NOW)).toBe("Wednesday");
    expect(dayLabel(at(31, 12, 0, 9), NOW)).toBe("Saturday");
    expect(dayLabel(at(30, 12, 0, 9), NOW)).toBe("30 October");
    expect(dayLabel(at(28, 12, 0, 11, 2025), NOW)).toBe("28 December 2025");
  });

  test("a time ahead of the clock is today", () => {
    expect(dayLabel(NOW + 3 * 60 * MIN, NOW)).toBe("Today");
  });
});

describe("groupByDay", () => {
  test("keeps the order and starts a group when the day changes", () => {
    const groups = groupByDay(
      [
        item("a"),
        item("b", { answeredAt: at(6, 8, 40) }),
        item("c", { answeredAt: at(5, 6, 2) }),
        item("d", { outcome: "missed", answeredAt: null, createdAt: at(5, 2, 14) }),
        item("e", { answeredAt: at(1, 12) }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.questionId)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c", "d"]],
      ["Sunday", ["e"]],
    ]);
  });

  test("nothing in, nothing out", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe("H2 and the flock", () => {
  test("no bots yet only once everything has loaded and is empty", () => {
    expect(isNoBotsYet({ waiting: [], history: [], historyDone: true })).toBe(true);
    expect(isNoBotsYet({ waiting: undefined, history: [], historyDone: true })).toBe(false);
    expect(isNoBotsYet({ waiting: [], history: undefined, historyDone: false })).toBe(false);
    expect(isNoBotsYet({ waiting: [], history: [], historyDone: false })).toBe(false);
    expect(isNoBotsYet({ waiting: [waiting("a")], history: [], historyDone: true })).toBe(false);
    expect(isNoBotsYet({ waiting: [], history: [item("a")], historyDone: true })).toBe(false);
  });

  test("known bots: one per name, the id from a waiting alert when there is one", () => {
    const bots = knownBots(
      [{ botId: "id-1", botName: "Sheldon" }],
      [{ botName: "Sheldon" }, { botName: "Brow" }, { botName: "Brow" }],
    );
    expect(bots).toEqual([
      { botId: "id-1", botName: "Sheldon" },
      { botId: "Brow", botName: "Brow" },
    ]);
  });

  test("the flock line", () => {
    expect(flockText(1)).toBe("1 bot can page you");
    expect(flockText(3)).toBe("3 bots can page you");
  });
});
