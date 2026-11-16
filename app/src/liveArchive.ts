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
  /** The note it ended with (or the last one given); absent from an older backend. */
  note?: string | null;
  /** Each step it moved to and each note it gave, oldest first, with when. */
  history: { step: string; at: number; note?: string }[];
}

/** The marks where the task moved to a new step (not the note-only updates). */
function stepChanges(history: ArchivedLive["history"]): number[] {
  const indices: number[] = [];
  let current = "";
  history.forEach((mark, index) => {
    if (mark.step !== "" && mark.step !== current) {
      indices.push(index);
      current = mark.step;
    }
  });
  return indices;
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
  const count = stepChanges(item.history).length;
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
  /** How long the step ran, up to the next step or the end; null on other lines. */
  took: string | null;
  /** A note is drawn under its step, smaller. */
  kind: "start" | "step" | "note" | "end";
  tone: "ok" | "bad" | "neutral";
}

/**
 * The detail's timeline: Started, each step with its time and how long it ran, every note the bot
 * gave (under its step, or on their own for a task with no steps) with its time, and how it ended.
 */
export function liveTimeline(item: ArchivedLive): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { label: "Started", time: clockWithSeconds(item.startedAt), took: null, kind: "start", tone: "neutral" },
  ];
  const changes = stepChanges(item.history);
  item.history.forEach((mark, index) => {
    const changeAt = changes.indexOf(index);
    if (changeAt >= 0) {
      const nextIndex = changes[changeAt + 1];
      const next = nextIndex === undefined ? item.endedAt : item.history[nextIndex]!.at;
      entries.push({ label: mark.step, time: clockWithSeconds(mark.at), took: durationLabel(next - mark.at), kind: "step", tone: "neutral" });
    }
    if (mark.note) entries.push({ label: mark.note, time: clockWithSeconds(mark.at), took: null, kind: "note", tone: "neutral" });
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

/** What the Archive opens on: today's entries, at most this many. "Show earlier" shows the rest. */
export const ARCHIVE_FIRST_VIEW = 10;

/**
 * The Archive's first view: the most recent entries from today, at most ten (fewer when today had
 * fewer). `hidden` says whether anything was left out, so the screen offers "Show earlier".
 */
export function archiveFirstView(
  groups: readonly { label: string; entries: ArchiveEntry[] }[],
  now: number,
  max = ARCHIVE_FIRST_VIEW,
): { groups: { label: string; entries: ArchiveEntry[] }[]; hidden: boolean } {
  const today = groups.find((group) => group.label === dayLabel(now, now));
  const shown = today ? today.entries.slice(0, max) : [];
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
  return { groups: shown.length > 0 ? [{ label: today!.label, entries: shown }] : [], hidden: total > shown.length };
}
