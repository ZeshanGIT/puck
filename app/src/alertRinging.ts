import { PUSH_CHANNEL_ID } from "@puck/shared";
import {
  bypassDecision,
  ringSecondsFor,
  urgentChannelId,
  type AlertPriority,
  type LocalSettings,
} from "./localSettings";

export interface RingingPlan {
  /** Android notification channel id (before the ringtone is added, see `ringChannelId`). */
  channelId: string;
  /** How long the card and the spoken text stay up before the alert settles into a quiet copy. The ringtone plays once, to the end. */
  ringSeconds: number;
  /** Whether the channel is on the alarm stream, so it rings in silent mode (urgent + silent bypass only). */
  useAlarmChannel: boolean;
  bypassDndOnChannel: boolean;
}

/**
 * How a full-screen push should ring on the phone. Normal alerts always use the shared
 * `puck-alerts` channel so they never pick up urgent bypass channels (see bypass QA matrix).
 * Urgent alerts use the existing per-decision urgent channels. Neither repeats its ringtone.
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
  const ringSeconds = ringSecondsFor(alert.ringSeconds);
  if (alert.priority === "normal") {
    return {
      channelId: PUSH_CHANNEL_ID,
      ringSeconds,
      useAlarmChannel: false,
      bypassDndOnChannel: false,
    };
  }
  const decision = bypassDecision(alert, settings, botId);
  const useAlarm = decision.silent && alarmChannelsCapable;
  return {
    channelId: urgentChannelId(decision, alarmChannelsCapable),
    ringSeconds,
    useAlarmChannel: useAlarm,
    bypassDndOnChannel: decision.dnd,
  };
}
