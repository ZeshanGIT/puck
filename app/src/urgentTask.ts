import notifee from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { onVolumeKey, subscribeOverlayAction } from "puck-full-screen";
import { handleNotifeeEvent, handleUrgentTask, silenceCardAlert, silenceRings } from "./urgentDisplay";

export const URGENT_TASK = "puck-urgent-alert";

TaskManager.defineTask(URGENT_TASK, ({ data }) => handleUrgentTask(data));

// Swiping the ringing notification away silences it; tapping it keeps the voice going (A4, J5).
notifee.onBackgroundEvent(handleNotifeeEvent);
notifee.onForegroundEvent(handleNotifeeEvent);

// A volume key silences the ring without answering, like a call (A4, J4).
onVolumeKey(silenceRings);

// Dismissing or snoozing the compact card stops its voice; the alert stays in the shade.
subscribeOverlayAction(({ questionId }) => {
  void silenceCardAlert(questionId);
});

void Notifications.registerTaskAsync(URGENT_TASK).catch(() => {});
