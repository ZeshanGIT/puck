/**
 * Sample alerts for H4 Alert detail (`puck://dev-alert?sample=detail`, dev builds only, see `App.tsx`),
 * with no backend: what `alerts.get` would give for an answered alert.
 *
 * - `detail`: Sheldon's "Merge the onboarding branch?", answered "Merge" with a reply, and the delivery
 *   failed after four tries, so Try again shows.
 * - `detail-ok`: Brow's "Clear out Downloads older than 30 days?", answered "Yes" and delivered.
 *
 * Times are relative to the moment a sample is opened; `freshDetail` turns them into real times.
 */
import type { AlertDetail, DetailTimelineEvent } from "../../../detailModel";

const MINUTE = 60 * 1000;

export const DETAIL_SAMPLE_NAMES = ["detail", "detail-ok"] as const;

export function isDetailSample(name: string): boolean {
  return (DETAIL_SAMPLE_NAMES as readonly string[]).includes(name);
}

/** The sample with its times moved to `now`; null for an unknown name. */
export function freshDetail(name: string, now: number = Date.now()): AlertDetail | null {
  switch (name) {
    case "detail":
      return failedSample(now);
    case "detail-ok":
      return deliveredSample(now);
    default:
      return null;
  }
}

function failedSample(now: number): AlertDetail {
  const created = now - 80 * MINUTE;
  const answered = now - 78 * MINUTE;
  const failed = now - 74 * MINUTE;
  const timeline: DetailTimelineEvent[] = [
    { kind: "created", at: created, text: "Sent by Sheldon" },
    { kind: "answered", at: answered, text: "Answered on Pixel 7" },
    { kind: "failed", at: failed, text: "Not delivered · tried 4 times" },
  ];
  return {
    questionId: "q_DETAIL1",
    question: "Merge the onboarding branch?",
    message: "Checks passed at 8:31. Squash and merge into main.",
    details: null,
    link: null,
    priority: "normal",
    presentation: "choice",
    selectionMode: "single",
    status: "answered",
    options: [
      { id: "merge", label: "Merge", icon: null, desc: null, tone: null, rec: true, chosen: true },
      { id: "hold", label: "Hold", icon: null, desc: "Leave it for tomorrow", tone: null, rec: false, chosen: false },
      {
        id: "close",
        label: "Close the branch",
        icon: null,
        desc: "Drops it without merging",
        tone: "destructive",
        rec: false,
        chosen: false,
      },
    ],
    expiresAt: null,
    createdAt: created,
    botId: "sheldon-23648",
    botName: "Sheldon",
    answer: {
      answerId: "sample-answer-detail",
      picks: ["Merge"],
      customReply: "Squash it, please.",
      attachments: [{ name: "build-log.txt", type: "file", size: 18 * 1024 }],
      answeredAt: answered,
      answeredByClientName: "Pixel 7",
    },
    delivery: { state: "failed", attempts: 4, lastError: "webhook timed out" },
    snoozes: [],
    timeline,
  };
}

function deliveredSample(now: number): AlertDetail {
  const created = now - 40 * MINUTE;
  const answered = now - 38 * MINUTE;
  const delivered = now - 38 * MINUTE + 2_000;
  const timeline: DetailTimelineEvent[] = [
    { kind: "created", at: created, text: "Sent by Brow" },
    { kind: "answered", at: answered, text: "Answered on Pixel 7" },
    { kind: "delivered", at: delivered, text: "Delivered to Brow" },
  ];
  return {
    questionId: "q_DETAIL2",
    question: "Clear out Downloads older than 30 days?",
    message: null,
    details: null,
    link: null,
    priority: "normal",
    presentation: "choice",
    selectionMode: "single",
    status: "answered",
    options: [
      { id: "yes", label: "Yes", icon: null, desc: null, tone: null, rec: false, chosen: true },
      { id: "later", label: "Not now", icon: null, desc: null, tone: null, rec: false, chosen: false },
    ],
    expiresAt: null,
    createdAt: created,
    botId: "brow-41907",
    botName: "Brow",
    answer: {
      answerId: "sample-answer-ok",
      picks: ["Yes"],
      customReply: null,
      attachments: [],
      answeredAt: answered,
      answeredByClientName: "Pixel 7",
    },
    delivery: { state: "delivered", attempts: 1, lastError: null },
    snoozes: [],
    timeline,
  };
}
