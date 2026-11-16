/**
 * What the floating card for a live task shows (`LiveFloat` in the native module): the step line,
 * the note, how far along the ring is, and the colours of the bot and the theme. Plain TypeScript,
 * no React, so it can be tested. `liveFloat.ts` decides when to show it.
 */
import type { LiveFloatSpec } from "puck-full-screen";
import type { LivePush } from "./livePayload";
import { closingLine, isEnded, stepsToGo } from "./liveNotificationModel";
import { hex6, overlayBotLook } from "./overlayCardModel";
import type { BlobBot } from "./ui/blobShapes";
import { darkTokens, lightTokens } from "./ui/tokens";

/** "Test · 3 to go", "Working" (no steps yet), or the closing line once it has ended. */
export function floatStepLine(push: Pick<LivePush, "currentStep" | "state" | "stepIndex" | "stepCount">): string {
  if (isEnded(push.state)) return closingLine(push.state);
  const step = push.currentStep.trim() === "" ? "Working" : push.currentStep;
  const toGo = stepsToGo(push);
  return toGo === null ? step : `${step} · ${toGo === 0 ? "last step" : `${toGo} to go`}`;
}

/** The ring: the share of steps done (0 to 1), all of it once ended, or null for a task with no steps. */
export function floatProgress(push: Pick<LivePush, "state" | "stepIndex" | "stepCount">): number | null {
  if (isEnded(push.state)) return 1;
  if (push.stepIndex === null || push.stepCount === null || push.stepCount < 1) return null;
  return Math.min(1, push.stepIndex / push.stepCount);
}

/** Changes when the task moves to another step: a "hide" lasts until then (notes alone do not bring it back). */
export function floatStepKey(push: Pick<LivePush, "stepIndex" | "currentStep">): string {
  return `${push.stepIndex ?? ""}:${push.currentStep}`;
}

export function liveFloatSpec(push: LivePush, bot: BlobBot, dark: boolean): LiveFloatSpec {
  const tokens = dark ? darkTokens : lightTokens;
  const look = overlayBotLook(bot, dark);
  return {
    activityId: push.activityId,
    botName: push.botName,
    title: push.title,
    stepLine: floatStepLine(push),
    note: push.note,
    state: push.state,
    stepKey: floatStepKey(push),
    progress: floatProgress(push),
    background: hex6(tokens.card),
    ink: hex6(tokens.ink),
    ink2: hex6(tokens.ink2),
    botColour: look.botColour,
    blobFill: look.blobFill,
    blobRim: look.blobRim,
    blobPath: look.blobPath,
    blobTilt: look.blobTilt,
    ok: hex6(tokens.ok),
    danger: hex6(tokens.danger),
  };
}
