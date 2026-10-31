import notifee, { AndroidImportance, AndroidVisibility } from "@notifee/react-native";
import { PUSH_URGENT_CHANNEL_ID } from "@puck/shared";
import { fullscreenAlert } from "./fullscreenPayload";

export async function displayUrgent(alert: { questionId: string; question: string; botName: string }): Promise<void> {
  await notifee.createChannel({
    id: PUSH_URGENT_CHANNEL_ID,
    name: "Urgent alerts",
    importance: AndroidImportance.HIGH,
    // Notifee is silent unless this is set. "default" is the system ringtone.
    sound: "default",
    vibration: true,
    visibility: AndroidVisibility.PUBLIC,
  });
  await notifee.displayNotification({
    id: alert.questionId,
    title: alert.botName,
    body: alert.question,
    data: { questionId: alert.questionId },
    android: {
      channelId: PUSH_URGENT_CHANNEL_ID,
      pressAction: { id: "default" },
      fullScreenAction: { id: "default" },
      visibility: AndroidVisibility.PUBLIC,
      tag: alert.questionId,
    },
  });
}

/** Removes the shade copy after the answer is stored. The id and the tag are both the question id. */
export async function clearDisplayedAlert(questionId: string): Promise<void> {
  try {
    await notifee.cancelNotification(questionId, questionId);
  } catch {
    // The inbox no longer shows the alert. A leftover shade copy can be dismissed by hand.
  }
}

export async function handleUrgentTask(data: unknown): Promise<void> {
  const alert = fullscreenAlert(data);
  if (!alert) return;
  await displayUrgent(alert);
}
