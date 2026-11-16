/**
 * Finished live activities in the Archive: the row among the alerts, and the timeline of steps
 * (each with when it started and how long it took) its detail shows. Plain TypeScript, no React,
 * so it can be tested.
 */
import type { LiveState } from "@puck/shared";
import { dayLabel, historyRow, type HistoryItem, type HistoryRowModel } from "./homeModel";
import { clockLabel } from "./receiptCopy";

/** One finished task, as `live.archive` returns it. */
export interface ArchivedLive {
  activityId: string;
  botId: string;
  botName: string;
  colour: string | null;
  title: string;
  steps: string[] | null;
  /** done, failed, or stale (left unfinished). */
  state: LiveState;
  startedAt: number;
  endedAt: number;
  /** Each step it moved to, oldest first, with when. */
  history: { step: string; at: number }[];
}

/** "45 s", "3 min", "1 h 5 min". */
export function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "9:12:05": steps can be seconds apart, so the timeline shows seconds. */
export function clockWithSeconds(ms: number): string {
  const date = new Date(ms);
  return `${clockLabel(ms)}:${String(date.getSeconds()).padStart(2, "0")}`;
}

const ENDING: Record<string, { word: string; tone: "ok" | "bad" | "neutral"; icon: "check" | "warn" | null }> = {
  done: { word: "Done", tone: "ok", icon: "check" },
  failed: { word: "Failed", tone: "bad", icon: "warn" },
  stale: { word: "Stopped", tone: "neutral", icon: null },
};

function ending(state: string) {
  return ENDING[state] ?? { word: "Ended", tone: "neutral" as const, icon: null };
}

export interface LiveArchiveRowModel {
  activityId: string;
  botId: string;
  botName: string;
  title: string;
  /** When it ended: where the row sorts among the alerts. */
  at: number;
  time: string;
  /** "Done · 6 steps · 1 min 15 s". */
  detail: string;
  tone: "ok" | "bad" | "neutral";
  icon: "check" | "warn" | null;
}

export function liveArchiveRow(item: ArchivedLive): LiveArchiveRowModel {
  const end = ending(item.state);
  const count = item.history.length;
  const parts = [end.word];
  if (count > 0) parts.push(count === 1 ? "1 step" : `${count} steps`);
  parts.push(durationLabel(item.endedAt - item.startedAt));
  return {
    activityId: item.activityId,
    botId: item.botId,
    botName: item.botName,
    title: item.title,
    at: item.endedAt,
    time: clockLabel(item.endedAt),
    detail: parts.join(" · "),
    tone: end.tone,
    icon: end.icon,
  };
}

export interface TimelineEntry {
  label: string;
  /** "9:12:05". */
  time: string;
  /** How long the step ran, up to the next one or the end; null on the closing line. */
  took: string | null;
  kind: "start" | "step" | "end";
  tone: "ok" | "bad" | "neutral";
}

/**
 * The detail's timeline: Started, each step with its time and how long it ran, and how it ended.
 * A step recorded at the very start shares the "Started" moment.
 */
export function liveTimeline(item: ArchivedLive): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { label: "Started", time: clockWithSeconds(item.startedAt), took: null, kind: "start", tone: "neutral" },
  ];
  item.history.forEach((mark, index) => {
    const next = item.history[index + 1]?.at ?? item.endedAt;
    entries.push({ label: mark.step, time: clockWithSeconds(mark.at), took: durationLabel(next - mark.at), kind: "step", tone: "neutral" });
  });
  const end = ending(item.state);
  entries.push({ label: end.word, time: clockWithSeconds(item.endedAt), took: null, kind: "end", tone: end.tone });
  return entries;
}

/** Steps it was given but never reached (a failed or stopped task), in order. */
export function stepsNotReached(item: ArchivedLive): string[] {
  if (item.steps === null) return [];
  const reached = new Set(item.history.map((mark) => mark.step));
  return item.steps.filter((step) => !reached.has(step));
}

export type ArchiveEntry = { kind: "alert"; row: HistoryRowModel } | { kind: "live"; row: LiveArchiveRowModel; item: ArchivedLive };

/**
 * Alerts and finished tasks in one list, newest first, by day. While older alerts are still to be
 * loaded, tasks older than the oldest alert shown wait too, so the list never skips back in time.
 */
export function archiveGroups(
  history: readonly HistoryItem[],
  live: readonly ArchivedLive[],
  moreAlerts: boolean,
  now: number,
): { label: string; entries: ArchiveEntry[] }[] {
  const alerts: ArchiveEntry[] = history.map((item) => ({ kind: "alert", row: historyRow(item) }));
  const oldestAlert = alerts.length > 0 ? Math.min(...alerts.map((entry) => entry.row.at)) : -Infinity;
  const tasks: ArchiveEntry[] = live
    .map((item) => ({ kind: "live" as const, row: liveArchiveRow(item), item }))
    .filter((entry) => !moreAlerts || entry.row.at >= oldestAlert);
  const all = [...alerts, ...tasks].sort((a, b) => b.row.at - a.row.at);
  const groups: { label: string; entries: ArchiveEntry[] }[] = [];
  for (const entry of all) {
    const label = dayLabel(entry.row.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}
