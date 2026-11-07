import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Changing the bypass settings in Settings (S4) must change how the NEXT urgent alert behaves.
 * `displayUrgent` loads the stored settings for every alert and never caches them, so this runs
 * the real `displayUrgent` against an in-memory store and records which channel it rings on and
 * for how long. The native modules are replaced by recorders.
 */

const store = new Map<string, string>();
const channels: { id: string; bypassDnd?: boolean }[] = [];
const alarmChannels: { id: string; bypassDnd: boolean }[] = [];
const notifications: { channelId: string; timeoutAfter?: number }[] = [];

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    store.delete(key);
  },
}));
mock.module("@notifee/react-native", () => ({
  default: {
    createChannel: async (channel: { id: string; bypassDnd?: boolean }) => {
      channels.push(channel);
      return channel.id;
    },
    displayNotification: async (notification: { android: { channelId: string; timeoutAfter?: number } }) => {
      notifications.push({ channelId: notification.android.channelId, timeoutAfter: notification.android.timeoutAfter });
    },
    cancelNotification: async () => {},
  },
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AndroidVisibility: { PUBLIC: 1 },
  EventType: { PRESS: 1, DISMISSED: 0 },
}));
mock.module("puck-full-screen", () => ({
  canCreateAlarmChannel: () => true,
  createAlarmChannel: (id: string, _name: string, bypassDnd: boolean) => {
    alarmChannels.push({ id, bypassDnd });
    return true;
  },
  hasDndAccess: () => true,
  isInCall: () => false,
  isLocked: () => false,
}));

type UrgentModule = typeof import("./urgentDisplay");
type SettingsModule = typeof import("./localSettings");
let urgent: UrgentModule;
let settings: SettingsModule;

beforeAll(async () => {
  urgent = await import("./urgentDisplay");
  settings = await import("./localSettings");
});

beforeEach(() => {
  store.clear();
  channels.length = 0;
  alarmChannels.length = 0;
  notifications.length = 0;
});

let counter = 0;
/** An urgent alert that asks to bypass both Do Not Disturb and silent mode. */
function asking(extra: Record<string, unknown> = {}) {
  counter += 1;
  return {
    questionId: `q_URGENTTEST${String(counter).padStart(6, "0")}`,
    question: "Deploy now?",
    botName: "Sheldon",
    bypassDnd: true,
    bypassSilent: true,
    ...extra,
  };
}

async function ring(alert: ReturnType<typeof asking>) {
  await urgent.displayUrgent(alert);
  await urgent.clearDisplayedAlert(alert.questionId);
  return notifications[notifications.length - 1]!;
}

describe("the next urgent alert reads the settings fresh", () => {
  test("default (urgent only): an urgent alert that asks rings on the alarm channel through Do Not Disturb", async () => {
    const note = await ring(asking());
    expect(note.channelId).toBe("puck-urgent-bypass");
    expect(alarmChannels[0]).toEqual({ id: "puck-urgent-bypass", bypassDnd: true });
    expect(note.timeoutAfter).toBe(60_000);
  });

  test("turning both bypass settings Off changes the very next alert to the plain channel", async () => {
    expect((await ring(asking())).channelId).toBe("puck-urgent-bypass");
    await settings.saveLocalSettings({ bypassDnd: "off", bypassSilent: "off" });
    const note = await ring(asking());
    expect(note.channelId).toBe("puck-urgent");
    expect(channels.some((channel) => channel.id === "puck-urgent" && channel.bypassDnd === false)).toBe(true);
  });

  test("each setting acts alone: Do Not Disturb off keeps silent mode, silent off keeps Do Not Disturb", async () => {
    await settings.saveLocalSettings({ bypassDnd: "off", bypassSilent: "urgent" });
    expect((await ring(asking())).channelId).toBe("puck-urgent-alarm");
    await settings.saveLocalSettings({ bypassDnd: "urgent", bypassSilent: "off" });
    expect((await ring(asking())).channelId).toBe("puck-urgent-dnd");
    await settings.saveLocalSettings({ bypassDnd: "all", bypassSilent: "all" });
    expect((await ring(asking())).channelId).toBe("puck-urgent-bypass");
  });

  test("an alert that does not ask never bypasses, whatever the settings say", async () => {
    await settings.saveLocalSettings({ bypassDnd: "all", bypassSilent: "all" });
    expect((await ring(asking({ bypassDnd: false, bypassSilent: false }))).channelId).toBe("puck-urgent");
  });

  test("the default ring length follows the setting; the alert's own ringSeconds still wins", async () => {
    await settings.saveLocalSettings({ ringSeconds: 120 });
    expect((await ring(asking())).timeoutAfter).toBe(120_000);
    await settings.saveLocalSettings({ ringSeconds: 30 });
    expect((await ring(asking())).timeoutAfter).toBe(30_000);
    expect((await ring(asking({ ringSeconds: 45 }))).timeoutAfter).toBe(45_000);
  });

  test("a bot's own override beats the global setting", async () => {
    await settings.saveLocalSettings({ bypassDnd: "off", bypassSilent: "off" });
    await settings.saveBotBypass("sheldon-11019", { dnd: "all" });
    expect((await ring(asking({ botId: "sheldon-11019" }))).channelId).toBe("puck-urgent-dnd");
    expect((await ring(asking({ botId: "brow-00007" }))).channelId).toBe("puck-urgent");
  });
});
