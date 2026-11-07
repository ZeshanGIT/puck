import { PUSH_CHANNEL_ID } from "@puck/shared";
import {
  bypassDecision,
  ringSecondsFor,
  urgentChannelId,
  type AlertPriority,
  type LocalSettings,
} from "./localSettings";

export interface RingingPlan {
  /** Android notification channel id for the incoming presentation. */
  channelId: string;
  /** Urgent alerts repeat sound until timeout; normal plays the channel sound once. */
  insistent: boolean;
  /** Android cancels the ringing notification after this many milliseconds. */
  timeoutMs: number | undefined;
  /** Whether to create an alarm-style channel (urgent + silent bypass only). */
  useAlarmChannel: boolean;
  bypassDndOnChannel: boolean;
}

/**
 * How a full-screen push should ring on the phone. Normal alerts always use the shared
 * `puck-alerts` channel so they never pick up urgent bypass channels (see bypass QA matrix).
 * Urgent alerts use the existing per-decision urgent channels.
 */
export function alertRingingPlan(
  alert: {
    priority: AlertPriority;
    ringSeconds?: number;
    bypassDnd?: boolean;
    bypassSilent?: boolean;
  },
  settings: LocalSettings,
  botId: string | undefined,
  alarmChannelsCapable: boolean,
): RingingPlan {
  if (alert.priority === "normal") {
    const seconds = ringSecondsFor(alert.ringSeconds, settings);
    return {
      channelId: PUSH_CHANNEL_ID,
      insistent: false,
      timeoutMs: seconds * 1000,
      useAlarmChannel: false,
      bypassDndOnChannel: false,
    };
  }
  const decision = bypassDecision(alert, settings, botId);
  const useAlarm = decision.silent && alarmChannelsCapable;
  const channelId = urgentChannelId(decision, alarmChannelsCapable);
  const seconds = ringSecondsFor(alert.ringSeconds, settings);
  return {
    channelId,
    insistent: true,
    timeoutMs: seconds * 1000,
    useAlarmChannel: useAlarm,
    bypassDndOnChannel: decision.dnd,
  };
}
