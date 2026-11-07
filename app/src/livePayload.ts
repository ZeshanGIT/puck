import { BOT_ID_PATTERN, LIVE_KIND, LIVE_STATES, type LiveState } from "@puck/shared";
import { notificationData } from "./dismissPayload";
import { requestedColour } from "./pairingModel";
import type { PaletteName } from "./ui/botTheme";

/** The data-only live-activity push (N8), `fcmLiveMessage` on the backend. No step list, no secrets. */
export interface LivePush {
  activityId: string;
  botId: string;
  botName: string;
  title: string;
  currentStep: string;
  state: LiveState;
  /** Epoch ms the task started: the chronometer counts from here. */
  startedAt: number;
  /** Epoch ms of this change: a late push older than one already shown is ignored. */
  updatedAt: number;
  colour: PaletteName | null;
  /** The current step's place on the track, when the bot gave steps. */
  stepIndex: number | null;
  stepCount: number | null;
}

/** FCM data values are strings: "1731000000000" becomes a number; a number stays; anything else is null. */
function wireNumber(value: unknown): number | null {
  const number = typeof value === "string" && /^\d{1,16}$/u.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function isLiveState(value: unknown): value is LiveState {
  return typeof value === "string" && (LIVE_STATES as readonly string[]).includes(value);
}

/**
 * Reads the push, in any shape the other push readers accept (Expo's `dataString`, a nested `data`,
 * or bare). Null for anything else, or one missing what the notification needs (an id, a bot, a
 * title, a state, the two times). `currentStep` may be empty (a task with no steps yet).
 */
export function livePush(payload: unknown): LivePush | null {
  const data = notificationData(payload);
  if (!data || data.kind !== LIVE_KIND) return null;
  const { activityId, botId, botName, title, currentStep, state, colour } = data;
  if (typeof activityId !== "string" || activityId === "") return null;
  if (typeof botId !== "string" || !BOT_ID_PATTERN.test(botId)) return null;
  if (typeof botName !== "string" || botName.trim() === "") return null;
  if (typeof title !== "string" || title.trim() === "") return null;
  if (!isLiveState(state)) return null;
  const startedAt = wireNumber(data.startedAt);
  const updatedAt = wireNumber(data.updatedAt);
  if (startedAt === null || updatedAt === null) return null;
  const stepIndex = wireNumber(data.stepIndex);
  const stepCount = wireNumber(data.stepCount);
  const track = stepIndex !== null && stepCount !== null && stepCount >= 1;
  return {
    activityId,
    botId,
    botName,
    title,
    currentStep: typeof currentStep === "string" ? currentStep : "",
    state,
    startedAt,
    updatedAt,
    colour: typeof colour === "string" ? requestedColour(colour) : null,
    stepIndex: track ? Math.min(stepIndex, stepCount - 1) : null,
    stepCount: track ? stepCount : null,
  };
}
