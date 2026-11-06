import { describe, expect, test } from "bun:test";
import {
  type AlertDetail,
  attachmentChips,
  deliveryError,
  hourMinute,
  isMissed,
  optionRows,
  replyQuote,
  retryErrorMessage,
  showTryAgain,
  statusLine,
  timelineRows,
  timelineTone,
  timeLabel,
} from "./detailModel";

// Local times, so the clock labels do not depend on the machine's zone.
const NOW = new Date(2026, 10, 6, 15, 30).getTime();
const TODAY_0904 = new Date(2026, 10, 6, 9, 4).getTime();
const YESTERDAY_2104 = new Date(2026, 10, 5, 21, 4).getTime();
const OLDER_0712 = new Date(2026, 9, 28, 7, 12).getTime();

function alert(overrides: Partial<AlertDetail> = {}): AlertDetail {
  return {
    questionId: "q_1",
    question: "Merge the onboarding branch?",
    message: null,
    details: null,
    link: null,
    priority: "normal",
    presentation: "choice",
    selectionMode: "single",
    status: "answered",
    options: [
      { id: "merge", label: "Merge", icon: null, desc: null, tone: null, rec: true, chosen: true },
      { id: "hold", label: "Hold", icon: null, desc: null, tone: null, rec: false, chosen: false },
      { id: "close", label: "Close", icon: null, desc: "Drops the branch", tone: "destructive", rec: false, chosen: false },
    ],
    expiresAt: null,
    createdAt: TODAY_0904,
    botId: "sheldon-23648",
    botName: "Sheldon",
    answer: {
      answerId: "a_1",
      picks: ["Merge"],
      customReply: "Squash it, please.",
      attachments: [{ name: "build-log.txt", type: "file", size: 18 * 1024 }],
      answeredAt: TODAY_0904 + 120_000,
      answeredByClientName: "Pixel 7",
    },
    delivery: { state: "failed", attempts: 4, lastError: "webhook timed out" },
    snoozes: [],
    timeline: [
      { kind: "created", at: TODAY_0904, text: "Sent by Sheldon" },
      { kind: "answered", at: TODAY_0904 + 120_000, text: "Answered on Pixel 7" },
      { kind: "failed", at: TODAY_0904 + 180_000, text: "Not delivered · tried 4 times" },
    ],
    ...overrides,
  };
}

describe("times", () => {
  test("hourMinute is 24-hour with two digits", () => {
    expect(hourMinute(new Date(2026, 10, 6, 9, 4).getTime())).toBe("09:04");
    expect(hourMinute(new Date(2026, 10, 6, 21, 4).getTime())).toBe("21:04");
  });

  test("timeLabel is the bare time today, with the day otherwise", () => {
    expect(timeLabel(TODAY_0904, NOW)).toBe("09:04");
    expect(timeLabel(YESTERDAY_2104, NOW)).toBe("Yesterday 21:04");
    expect(timeLabel(OLDER_0712, NOW)).toBe("28 October 07:12");
  });
});

describe("status line", () => {
  test("answered says so", () => {
    expect(statusLine(alert(), NOW)).toBe("You answered");
  });

  test("cancelled, from the status or the timeline", () => {
    const cancelled = alert({ answer: null, delivery: null, status: "cancelled", timeline: [] });
    expect(statusLine(cancelled, NOW)).toBe("Cancelled");
    const fromTimeline = alert({
      answer: null,
      delivery: null,
      status: "pending",
      timeline: [{ kind: "cancelled", at: TODAY_0904, text: "Cancelled by Sheldon" }],
    });
    expect(statusLine(fromTimeline, NOW)).toBe("Cancelled");
  });

  test("missed after expiry, with no answer", () => {
    const missed = alert({ answer: null, delivery: null, status: "pending", expiresAt: NOW - 1000 });
    expect(isMissed(missed, NOW)).toBe(true);
    expect(statusLine(missed, NOW)).toBe("Missed");
  });

  test("an answered alert is never missed", () => {
    const answered = alert({ expiresAt: NOW - 1000 });
    expect(isMissed(answered, NOW)).toBe(false);
  });

  test("snoozed shows the note of the latest snooze", () => {
    const timed = alert({
      answer: null,
      delivery: null,
      status: "snoozed",
      snoozes: [
        { at: NOW - 60_000, until: NOW + 5 * 60_000 },
        { at: NOW - 30_000, until: NOW + 10 * 60_000 },
      ],
    });
    expect(statusLine(timed, NOW)).toBe("Back in 10 min");
    const untilBack = alert({
      answer: null,
      delivery: null,
      status: "snoozed",
      snoozes: [{ at: NOW - 30_000, until: null }],
    });
    expect(statusLine(untilBack, NOW)).toBe("Snoozed until you're back");
  });

  test("waiting with no answer reads Unanswered", () => {
    const waiting = alert({ answer: null, delivery: null, status: "pending" });
    expect(statusLine(waiting, NOW)).toBe("Unanswered");
  });
});

describe("options", () => {
  test("marks the chosen options as picked", () => {
    const rows = optionRows(alert());
    expect(rows.map((row) => row.picked)).toEqual([true, false, false]);
  });

  test("the destructive tone is kept and the description is passed on", () => {
    const close = optionRows(alert())[2]!;
    expect(close.destructive).toBe(true);
    expect(close.desc).toBe("Drops the branch");
  });

  test("a missed alert shows no picks", () => {
    const missed = alert({ answer: null, delivery: null, status: "pending", expiresAt: NOW - 1000 });
    expect(optionRows(missed).some((row) => row.picked)).toBe(false);
  });
});

describe("timeline", () => {
  test("rows keep the backend's order, with the time and the dot's tone", () => {
    const rows = timelineRows(alert(), NOW);
    expect(rows.map((row) => row.text)).toEqual([
      "Sent by Sheldon",
      "Answered on Pixel 7",
      "Not delivered · tried 4 times",
    ]);
    expect(rows.map((row) => row.time)).toEqual(["09:04", "09:06", "09:07"]);
    expect(rows.map((row) => row.tone)).toEqual(["ok", "ok", "bad"]);
  });

  test("tones by kind", () => {
    expect(timelineTone("delivered")).toBe("ok");
    expect(timelineTone("missed")).toBe("bad");
    expect(timelineTone("snoozed")).toBe("neutral");
    expect(timelineTone("cancelled")).toBe("neutral");
  });
});

describe("Try again", () => {
  test("shows for a failed delivery of an answer", () => {
    expect(showTryAgain(alert())).toBe(true);
    expect(deliveryError(alert())).toBe("webhook timed out");
  });

  test("hidden when delivered, pending, or with no answer", () => {
    expect(showTryAgain(alert({ delivery: { state: "delivered", attempts: 1, lastError: null } }))).toBe(false);
    expect(showTryAgain(alert({ delivery: { state: "pending", attempts: 2, lastError: null } }))).toBe(false);
    const noAnswer = alert({ answer: null, delivery: { state: "failed", attempts: 1, lastError: "x" } });
    expect(showTryAgain(noAnswer)).toBe(false);
    expect(deliveryError(noAnswer)).toBeNull();
  });

  test("the server's message is taken from a Convex-wrapped error", () => {
    const wrapped = new Error("[Request ID: 1a2b] Server Error\nUncaught Error: retry too soon: wait 10 seconds between tries\n at x");
    expect(retryErrorMessage(wrapped)).toBe("retry too soon: wait 10 seconds between tries");
    expect(retryErrorMessage(new Error("answer delivery is already pending"))).toBe("answer delivery is already pending");
    expect(retryErrorMessage("nope")).toBe("Something went wrong");
  });
});

describe("answer parts", () => {
  test("the reply quote and the attachment chips", () => {
    expect(replyQuote(alert())).toBe("Squash it, please.");
    expect(replyQuote(alert({ answer: null }))).toBeNull();
    expect(attachmentChips(alert())).toEqual([{ key: "0-build-log.txt", name: "build-log.txt", size: "18 KB" }]);
    expect(attachmentChips(alert({ answer: null }))).toEqual([]);
  });
});
