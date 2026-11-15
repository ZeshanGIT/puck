import notifee from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { clearOverlayReply, onVolumeKey, subscribeOverlayAction, takeOverlayReplies } from "puck-full-screen";
import { handleCardReply } from "./cardReply";
import { handleNotifeeEvent, handleUrgentTask, laterCardAlert, silenceCardAlert, silenceRings } from "./urgentDisplay";

export const URGENT_TASK = "puck-urgent-alert";

TaskManager.defineTask(URGENT_TASK, ({ data }) => handleUrgentTask(data));

// Swiping the ringing notification away silences it; tapping it keeps the voice going (A4, J5).
notifee.onBackgroundEvent(handleNotifeeEvent);
notifee.onForegroundEvent(handleNotifeeEvent);

// A volume key silences the ring without answering, like a call (A4, J4).
onVolumeKey(silenceRings);

// Dismissing or snoozing the compact card stops its voice; the alert stays in the shade. "Later"
// (swiped down) also keeps its reminders. An answer picked or typed on the card is sent (or
// queued) without opening Puck.
subscribeOverlayAction((action) => {
  if (action.action === "reply") {
    void handleCardReply(
      {
        questionId: action.questionId,
        text: action.text ?? "",
        nonce: action.nonce ?? 0,
        ...(action.optionIds ? { optionIds: action.optionIds } : {}),
      },
      clearOverlayReply,
    );
    return;
  }
  if (action.action === "later") {
    void laterCardAlert(action.questionId);
    return;
  }
  void silenceCardAlert(action.questionId);
});

// A reply typed while Puck was closed waits on the phone; take it now.
for (const reply of takeOverlayReplies()) {
  void handleCardReply(reply, clearOverlayReply);
}

void Notifications.registerTaskAsync(URGENT_TASK).catch(() => {});
