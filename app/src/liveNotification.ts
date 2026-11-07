import notifee, { AndroidImportance, AndroidVisibility } from "@notifee/react-native";
import type { LivePush } from "./livePayload";
import { decideLive, liveNotificationSpec, NOTHING_SEEN, type LiveSeen } from "./liveNotificationModel";

/**
 * N8, a bot's running task in the shade and on the lock screen. One ongoing notification per task,
 * updated in place on every push (the id comes from the activity id). It never rings, vibrates or
 * heads-up: its channel is low importance with no sound. It shows the task, the current step (and
 * how many are to go), a chronometer from when the task started, and a progress bar when the bot
 * gave steps. When the task ends the ongoing notification becomes a brief closing line ("Finished")
 * that clears itself. Tapping it opens the app on Home.
 *
 * Notifee 9.1.8 has no `Notification.ProgressStyle` (Android 16's segmented progress with a tracker
 * icon), so the progress is the plain bar, and there is no blob bitmap as an icon yet (that needs the
 * still blob drawn to image files, which Android reads from resources). The bot's colour is the
 * notification's accent instead. The pure parts are in `liveNotificationModel.ts`.
 */
export const LIVE_CHANNEL_ID = "puck-live";

/** What this run of the app has shown, so late or repeated pushes do nothing. */
let seen: LiveSeen = NOTHING_SEEN;

async function ensureLiveChannel(): Promise<string> {
  await notifee.createChannel({
    id: LIVE_CHANNEL_ID,
    name: "Working now",
    description: "A bot's running task, updated quietly as it goes",
    // Low: shows in the shade, with no sound and no heads-up.
    importance: AndroidImportance.LOW,
    vibration: false,
    visibility: AndroidVisibility.PUBLIC,
    badge: false,
  });
  return LIVE_CHANNEL_ID;
}

/** Shows, updates or ends the notification for a live-activity push. */
export async function handleLivePush(push: LivePush): Promise<void> {
  const decision = decideLive(seen, push);
  if (decision.action === "ignore") return;
  seen = decision.seen;
  for (const id of decision.cancel) {
    try {
      await notifee.cancelNotification(id, id);
    } catch {
      // Already gone.
    }
  }
  const spec = liveNotificationSpec(push);
  const channelId = await ensureLiveChannel();
  await notifee.displayNotification({
    id: spec.id,
    title: spec.title,
    body: spec.body,
    subtitle: spec.subtitle,
    data: { kind: "live", activityId: push.activityId },
    android: {
      channelId,
      tag: spec.id,
      ongoing: spec.ongoing,
      autoCancel: !spec.ongoing,
      onlyAlertOnce: true,
      pressAction: { id: "default" },
      visibility: AndroidVisibility.PUBLIC,
      ...(spec.colour === null ? {} : { color: spec.colour }),
      ...(spec.progress === null ? {} : { progress: { max: spec.progress.max, current: spec.progress.current } }),
      ...(spec.chronometerFrom === null
        ? { showChronometer: false }
        : { showChronometer: true, timestamp: spec.chronometerFrom }),
      ...(spec.timeoutAfter === null ? {} : { timeoutAfter: spec.timeoutAfter }),
    },
  });
}
