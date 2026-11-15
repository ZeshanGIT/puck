import {
  bypassDecision,
  normalChannelId,
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
  /** Whether the channel is on the alarm stream, so it rings in silent mode (silent bypass allowed for its kind). */
  useAlarmChannel: boolean;
  bypassDndOnChannel: boolean;
}

/**
 * How a full-screen push should ring on the phone. A normal alert rings on `puck-alerts`, an urgent
 * one on `puck-urgent`; either moves to its Do Not Disturb or alarm-stream variant only when the
 * alert asked to bypass and the setting for its kind (the bot's own, else the app's) allows it.
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
  const decision = bypassDecision(alert, settings, botId);
  const useAlarm = decision.silent && alarmChannelsCapable;
  return {
    channelId:
      alert.priority === "urgent"
        ? urgentChannelId(decision, alarmChannelsCapable)
        : normalChannelId(decision, alarmChannelsCapable),
    ringSeconds,
    useAlarmChannel: useAlarm,
    bypassDndOnChannel: decision.dnd,
  };
}
