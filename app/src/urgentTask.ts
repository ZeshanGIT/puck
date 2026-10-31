import notifee from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { handleUrgentTask } from "./urgentDisplay";

export const URGENT_TASK = "puck-urgent-alert";

TaskManager.defineTask(URGENT_TASK, ({ data }) => handleUrgentTask(data));

notifee.onBackgroundEvent(async () => {});

void Notifications.registerTaskAsync(URGENT_TASK).catch(() => {});
