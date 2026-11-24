import type { LiveCommand } from "@puck/shared";
import { applyStep, applySteps, currentNote, startTrack, type Track } from "./liveRules";

export interface BotActivity {
  alertId: string;
  sequence: number;
  title: string;
  link: string | null;
  note: string | null;
  track: Track;
  state: "running" | "done" | "failed";
  updatedAt: number;
}

export function startBotActivity(command: Extract<LiveCommand, { action: "start" }>, alertId: string, now: number): BotActivity {
  return {
    alertId,
    sequence: 1,
    title: command.title,
    link: command.link,
    note: command.note,
    track: startTrack(command.steps),
    state: "running",
    updatedAt: now,
  };
}

export function updateBotActivity(
  row: BotActivity,
  command: Exclude<LiveCommand, { action: "start" }>,
  now: number,
): BotActivity {
  const next = { ...row, sequence: row.sequence + 1, updatedAt: now };
  switch (command.action) {
    case "step":
      next.track = applyStep(row.track, command.step);
      next.note = currentNote(row.note ?? undefined, command.note, next.track.currentStep !== row.track.currentStep) ?? null;
      break;
    case "steps":
      next.track = applySteps(row.track, command.steps);
      break;
    case "note":
      next.note = command.note;
      break;
    case "end":
      next.state = command.state;
      next.note = command.note ?? row.note;
      break;
  }
  return next;
}
