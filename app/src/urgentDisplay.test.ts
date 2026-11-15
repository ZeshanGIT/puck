import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { PUSH_CHANNEL_ID } from "@puck/shared";

/**
 * Changing the bypass settings in Settings (S4) must change how the NEXT urgent alert behaves.
 * `displayUrgent` loads the stored settings for every alert and never caches them, so this runs
 * the real `displayUrgent` against an in-memory store and records which channel it rings on, with
 * which ringtone, and which reminders it schedules. The native modules are replaced by recorders.
 */

const store = new Map<string, string>();
const channels: { id: string; bypassDnd?: boolean }[] = [];
const ringChannels: {
  id: string;
  soundUri: string;
  stream: string;
  bypassDnd: boolean;
  headsUp: boolean;
}[] = [];
const notifications: { channelId: string; loopSound?: boolean; timeoutAfter?: number; fullScreen: boolean }[] = [];
const scheduled: { id: string; channelId: string; timestamp: number; timeoutAfter?: number }[] = [];
const cancelled: string[] = [];
const cards: { questionId: string; title: string; label: string; background: string }[] = [];
const hidden: string[] = [];
const fullScreens: string[] = [];
const overlay = { allowed: false, locked: false, shown: true, appOpen: false, screenOn: true, nativeRing: true, opens: true };
let channelGate: Promise<void> | null = null;
let channelEntered: (() => void) | null = null;
// Appearance is a native boundary; do not load the RN runtime in a Bun unit test.
mock.module("./overlayCard", () => ({ systemIsDark: async () => false }));

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
      channelEntered?.();
      if (channelGate) await channelGate;
      channels.push(channel);
      return channel.id;
    },
    displayNotification: async (notification: {
      android: { channelId: string; loopSound?: boolean; timeoutAfter?: number; fullScreenAction?: unknown };
    }) => {
      notifications.push({
        channelId: notification.android.channelId,
        loopSound: notification.android.loopSound,
        timeoutAfter: notification.android.timeoutAfter,
        fullScreen: notification.android.fullScreenAction !== undefined,
      });
    },
    createTriggerNotification: async (
      notification: { id: string; android: { channelId: string; timeoutAfter?: number } },
      trigger: { timestamp: number },
    ) => {
      scheduled.push({
        id: notification.id,
        channelId: notification.android.channelId,
        timestamp: trigger.timestamp,
        timeoutAfter: notification.android.timeoutAfter,
      });
    },
    cancelNotification: async (id: string) => {
      cancelled.push(id);
    },
  },
  AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 1 },
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AndroidVisibility: { PUBLIC: 1 },
  EventType: { PRESS: 1, DISMISSED: 0 },
  TriggerType: { TIMESTAMP: 0 },
}));
mock.module("puck-full-screen", () => ({
  canCreateRingChannel: () => overlay.nativeRing,
  createRingChannel: (
    id: string,
    _name: string,
    soundUri: string,
    stream: string,
    bypassDnd: boolean,
    headsUp: boolean,
  ) => {
    ringChannels.push({ id, soundUri, stream, bypassDnd, headsUp });
    return true;
  },
  isAppInForeground: () => overlay.appOpen,
  isScreenOn: () => overlay.screenOn,
  hasDndAccess: () => true,
  isInCall: () => false,
  isLocked: () => overlay.locked,
  canDrawOverlay: () => overlay.allowed,
  showOverlayCard: (card: { questionId: string; title: string; label: string; background: string }) => {
    cards.push(card);
    return overlay.shown;
  },
  hideOverlayCard: (questionId: string) => {
    hidden.push(questionId);
  },
  openAlertFullScreen: (questionId: string) => {
    fullScreens.push(questionId);
    return overlay.opens;
  },
  takeOverlayOpen: () => null,
  subscribeOverlayOpen: () => () => {},
  subscribeOverlayAction: () => () => {},
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
  ringChannels.length = 0;
  notifications.length = 0;
  scheduled.length = 0;
  cancelled.length = 0;
  cards.length = 0;
  hidden.length = 0;
  fullScreens.length = 0;
  overlay.opens = true;
  overlay.allowed = false;
  overlay.locked = false;
  overlay.shown = true;
  overlay.appOpen = false;
  overlay.screenOn = true;
  overlay.nativeRing = true;
  channelGate = null;
  channelEntered = null;
});

let counter = 0;
/** An urgent alert that asks to bypass both Do Not Disturb and silent mode. */
function asking(extra: Record<string, unknown> = {}) {
  counter += 1;
  return {
    questionId: `q_URGENTTEST${String(counter).padStart(6, "0")}`,
    question: "Deploy now?",
    botName: "Sheldon",
    priority: "urgent" as const,
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

describe("normal full-screen presentation", () => {
  test("rings once on the normal alerts channel, on the ring volume, when only urgent alerts may bypass", async () => {
    await settings.saveLocalSettings({ bypassDnd: "urgent", bypassSilent: "urgent" });
    const note = await ring(asking({ priority: "normal", bypassDnd: true, bypassSilent: true }));
    expect(note.channelId).toBe(`${PUSH_CHANNEL_ID}-rd`);
    expect(note.loopSound).toBeUndefined();
    expect(note.timeoutAfter).toBeUndefined();
    expect(ringChannels[0]).toEqual({
      id: `${PUSH_CHANNEL_ID}-rd`,
      soundUri: "",
      stream: "ring",
      bypassDnd: false,
      headsUp: true,
    });
  });

  test("with its own switches on, a normal alert rings through Do Not Disturb on the alarm stream", async () => {
    await settings.saveLocalSettings({ bypassDnd: "normal", bypassSilent: "all" });
    const note = await ring(asking({ priority: "normal", bypassDnd: true, bypassSilent: true }));
    expect(note.channelId).toBe(`${PUSH_CHANNEL_ID}-bypass-rd`);
    expect(ringChannels[0]).toMatchObject({ stream: "alarm", bypassDnd: true });
  });

  test("a normal alert reminds only when its reminders are on; urgent ones every 5 minutes by default", async () => {
    await urgent.displayUrgent(asking({ priority: "normal" }));
    expect(scheduled).toEqual([]);
    await urgent.displayUrgent(asking({ priority: "urgent" }));
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled[1]!.timestamp - scheduled[0]!.timestamp).toBe(5 * 60_000);
    scheduled.length = 0;
    await settings.saveLocalSettings({ reminderMinutesNormal: 10 });
    const calm = asking({ priority: "normal" });
    await urgent.displayUrgent(calm);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled[0]!.channelId.startsWith(PUSH_CHANNEL_ID)).toBe(true);
    expect(scheduled[1]!.timestamp - scheduled[0]!.timestamp).toBe(10 * 60_000);
  });

  test("a normal alert plays the ringtone chosen for normal alerts, not the urgent one", async () => {
    await settings.saveLocalSettings({ normalRingtone: "content://media/internal/audio/media/11", urgentRingtone: "content://media/internal/audio/media/22" });
    await ring(asking({ priority: "normal" }));
    expect(ringChannels[0]!.soundUri).toBe("content://media/internal/audio/media/11");
    expect(ringChannels[0]!.id).not.toBe(`${PUSH_CHANNEL_ID}-rd`);
  });
});

describe("the compact card over other apps", () => {
  test("an unlocked phone with the permission shows the card, and clearing the alert hides it", async () => {
    overlay.allowed = true;
    const alert = asking({ priority: "normal", question: "Lunch?", botName: "Cortana" });
    await urgent.displayUrgent(alert);
    expect(cards.map((card) => card.questionId)).toEqual([alert.questionId]);
    expect(cards[0]!.title).toBe("Cortana");
    expect(cards[0]!.label).toBe("Alert");
    await urgent.clearDisplayedAlert(alert.questionId);
    expect(hidden).toContain(alert.questionId);
  });

  test("full screen chosen for urgent alerts: an urgent alert takes the screen, a normal one keeps the card", async () => {
    overlay.allowed = true;
    await settings.saveLocalSettings({ fullScreenUrgent: true });
    const loud = asking({ priority: "urgent" });
    const note = await ring(loud);
    expect(fullScreens).toEqual([loud.questionId]);
    expect(cards).toEqual([]);
    // No heads-up banner on top of the full-screen alert either.
    expect(note.channelId).toContain("-card");
    const calm = asking({ priority: "normal" });
    await urgent.displayUrgent(calm);
    expect(fullScreens).toEqual([loud.questionId]);
    expect(cards.map((card) => card.questionId)).toEqual([calm.questionId]);
  });

  test("a bot's own choice wins over the app's, either way", async () => {
    overlay.allowed = true;
    await settings.saveLocalSettings({ fullScreenNormal: true });
    const alert = asking({ priority: "normal", botId: "sheldon-11019" });
    await settings.saveBotBypass("sheldon-11019", { fullScreenNormal: false });
    await urgent.displayUrgent(alert);
    expect(fullScreens).toEqual([]);
    expect(cards.map((card) => card.questionId)).toEqual([alert.questionId]);
  });

  test("when Android refuses the full screen, the card shows instead", async () => {
    overlay.allowed = true;
    overlay.opens = false;
    await settings.saveLocalSettings({ fullScreenNormal: true });
    const alert = asking({ priority: "normal" });
    await urgent.displayUrgent(alert);
    expect(fullScreens).toEqual([alert.questionId]);
    expect(cards.map((card) => card.questionId)).toEqual([alert.questionId]);
  });

  test("full screen chosen but the phone is locked: the usual full-screen alert, nothing extra", async () => {
    overlay.allowed = true;
    overlay.locked = true;
    await settings.saveLocalSettings({ fullScreenUrgent: true, fullScreenNormal: true });
    await urgent.displayUrgent(asking());
    expect(fullScreens).toEqual([]);
    expect(cards).toEqual([]);
  });

  test("a locked phone keeps the full-screen alert: no card", async () => {
    overlay.allowed = true;
    overlay.locked = true;
    await urgent.displayUrgent(asking());
    expect(cards).toEqual([]);
  });

  test("without the permission the notification alone carries the alert", async () => {
    await urgent.displayUrgent(asking());
    expect(cards).toEqual([]);
    expect(notifications.length).toBeGreaterThan(0);
  });

  test("with the card, the ring moves to a no-banner channel so a heads-up cannot cover the card", async () => {
    overlay.allowed = true;
    const note = await ring(asking({ priority: "normal", question: "Lunch?" }));
    expect(note.channelId).toBe("puck-alerts-card-rd");
    expect(ringChannels.find((channel) => channel.id === "puck-alerts-card-rd")?.headsUp).toBe(false);
  });

  test("without the card, the ring keeps the heads-up channel", async () => {
    const note = await ring(asking({ priority: "normal", question: "Lunch?" }));
    expect(note.channelId).toBe(`${PUSH_CHANNEL_ID}-rd`);
    expect(ringChannels.find((channel) => channel.id === `${PUSH_CHANNEL_ID}-rd`)?.headsUp).toBe(true);
  });

  test("an urgent alert with the card rings on the card variant of its channel", async () => {
    overlay.allowed = true;
    const note = await ring(asking());
    expect(note.channelId).toBe("puck-urgent-bypass-card-rd");
    expect(ringChannels[0]).toMatchObject({ id: "puck-urgent-bypass-card-rd", stream: "alarm", bypassDnd: true });
  });

  test("Puck already open: no card, the full-screen alert has the screen", async () => {
    overlay.allowed = true;
    overlay.appOpen = true;
    const note = await ring(asking({ priority: "normal" }));
    expect(cards).toEqual([]);
    expect(note.channelId).toBe(`${PUSH_CHANNEL_ID}-rd`);
  });

  test("screen off: no card, the full-screen alert wakes the phone", async () => {
    overlay.allowed = true;
    overlay.screenOn = false;
    await urgent.displayUrgent(asking());
    expect(cards).toEqual([]);
  });

  test("dismissing the card stops the ring and leaves the alert waiting, quietly, in the shade", async () => {
    overlay.allowed = true;
    const alert = asking({ priority: "normal", question: "Lunch?" });
    await urgent.displayUrgent(alert);
    await urgent.silenceCardAlert(alert.questionId);
    expect(notifications[notifications.length - 1]!.channelId).toBe("puck-urgent-waiting");
  });

  test("dismissing the card also ends the reminders", async () => {
    overlay.allowed = true;
    const alert = asking();
    await urgent.displayUrgent(alert);
    expect(scheduled.length).toBeGreaterThan(0);
    await urgent.silenceCardAlert(alert.questionId);
    for (const reminder of scheduled) expect(cancelled).toContain(reminder.id);
  });
});

describe("the next urgent alert reads the settings fresh", () => {
  test("default (urgent only): an urgent alert that asks rings on the alarm channel through Do Not Disturb", async () => {
    const note = await ring(asking());
    expect(note.channelId).toBe("puck-urgent-bypass-rd");
    expect(ringChannels[0]).toMatchObject({ id: "puck-urgent-bypass-rd", stream: "alarm", bypassDnd: true });
    // The ringtone plays once: nothing loops it and nothing cuts it short.
    expect(note.loopSound).toBeUndefined();
    expect(note.timeoutAfter).toBeUndefined();
  });

  test("an urgent alert that does not bypass silent mode follows the ring volume", async () => {
    await settings.saveLocalSettings({ bypassSilent: "off" });
    await ring(asking());
    expect(ringChannels[0]).toMatchObject({ stream: "ring", bypassDnd: true });
  });

  test("a bot's own ringtone beats the global one, for its own alerts only", async () => {
    await settings.saveLocalSettings({ urgentRingtone: "content://media/internal/audio/media/22" });
    await settings.saveBotBypass("sheldon-11019", { urgentRingtone: "content://media/internal/audio/media/44" });
    await ring(asking({ botId: "sheldon-11019" }));
    expect(ringChannels.every((channel) => channel.soundUri === "content://media/internal/audio/media/44")).toBe(true);
    ringChannels.length = 0;
    await ring(asking({ botId: "brow-00007" }));
    expect(ringChannels.every((channel) => channel.soundUri === "content://media/internal/audio/media/22")).toBe(true);
  });

  test("with repeating on for a kind of alert, its ringtone loops until the ring time is up", async () => {
    await settings.saveLocalSettings({ loopUrgent: true });
    const note = await ring(asking());
    expect(note.loopSound).toBe(true);
    expect(note.timeoutAfter).toBe(60_000);
    // The switch is per kind: normal alerts still play once.
    expect((await ring(asking({ priority: "normal" }))).loopSound).toBeUndefined();
    await settings.saveLocalSettings({ loopNormal: true });
    const normal = await ring(asking({ priority: "normal", ringSeconds: 45 }));
    expect(normal.loopSound).toBe(true);
    expect(normal.timeoutAfter).toBe(45_000);
  });

  test("a bot can repeat its own ringtone, or not, whatever Alert sounds says", async () => {
    await settings.saveLocalSettings({ loopUrgent: true });
    await settings.saveBotBypass("sheldon-11019", { loopUrgent: false });
    expect((await ring(asking({ botId: "sheldon-11019" }))).loopSound).toBeUndefined();
    expect((await ring(asking({ botId: "brow-00007" }))).loopSound).toBe(true);
    await settings.saveLocalSettings({ loopUrgent: false });
    await settings.saveBotBypass("brow-00007", { loopUrgent: true });
    expect((await ring(asking({ botId: "brow-00007" }))).loopSound).toBe(true);
  });

  test("reminders never loop, even with repeating on", async () => {
    await settings.saveLocalSettings({ loopUrgent: true });
    await ring(asking());
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.every((reminder) => reminder.timeoutAfter === 5 * 60_000)).toBe(true);
  });

  test("an urgent alert plays the urgent ringtone", async () => {
    await settings.saveLocalSettings({ urgentRingtone: "content://media/internal/audio/media/22" });
    await ring(asking());
    expect(ringChannels[0]!.soundUri).toBe("content://media/internal/audio/media/22");
  });

  test("turning both bypass settings Off changes the very next alert to the plain channel", async () => {
    expect((await ring(asking())).channelId).toBe("puck-urgent-bypass-rd");
    await settings.saveLocalSettings({ bypassDnd: "off", bypassSilent: "off" });
    const note = await ring(asking());
    expect(note.channelId).toBe("puck-urgent-rd");
    expect(ringChannels.some((channel) => channel.id === "puck-urgent-rd" && channel.bypassDnd === false)).toBe(true);
  });

  test("each setting acts alone: Do Not Disturb off keeps silent mode, silent off keeps Do Not Disturb", async () => {
    await settings.saveLocalSettings({ bypassDnd: "off", bypassSilent: "urgent" });
    expect((await ring(asking())).channelId).toBe("puck-urgent-alarm-rd");
    await settings.saveLocalSettings({ bypassDnd: "urgent", bypassSilent: "off" });
    expect((await ring(asking())).channelId).toBe("puck-urgent-dnd-rd");
    await settings.saveLocalSettings({ bypassDnd: "all", bypassSilent: "all" });
    expect((await ring(asking())).channelId).toBe("puck-urgent-bypass-rd");
  });

  test("an alert that does not ask never bypasses, whatever the settings say", async () => {
    await settings.saveLocalSettings({ bypassDnd: "all", bypassSilent: "all" });
    expect((await ring(asking({ bypassDnd: false, bypassSilent: false }))).channelId).toBe("puck-urgent-rd");
  });

  test("a bot's own override beats the global setting", async () => {
    await settings.saveLocalSettings({ bypassDnd: "off", bypassSilent: "off" });
    await settings.saveBotBypass("sheldon-11019", { dnd: "all" });
    expect((await ring(asking({ botId: "sheldon-11019" }))).channelId).toBe("puck-urgent-dnd-rd");
    expect((await ring(asking({ botId: "brow-00007" }))).channelId).toBe("puck-urgent-rd");
  });
});

describe("reminders for an unanswered urgent alert", () => {
  test("by default it reminds every 5 minutes, as scheduled notifications on its ringing channel", async () => {
    const before = Date.now();
    const alert = asking();
    await urgent.displayUrgent(alert);
    expect(scheduled).toHaveLength(12);
    expect(scheduled[0]!.id).toBe(`${alert.questionId}~remind-1`);
    expect(scheduled[0]!.timestamp - before).toBeGreaterThanOrEqual(5 * 60_000);
    expect(scheduled[1]!.timestamp - scheduled[0]!.timestamp).toBe(5 * 60_000);
    expect(scheduled[0]!.channelId).toBe("puck-urgent-bypass-rd");
    expect(scheduled[0]!.timeoutAfter).toBe(5 * 60_000);
    await urgent.clearDisplayedAlert(alert.questionId);
  });

  test("answering, snoozing or dropping the alert cancels every reminder", async () => {
    const alert = asking();
    await urgent.displayUrgent(alert);
    await urgent.clearDisplayedAlert(alert.questionId);
    for (const reminder of scheduled) expect(cancelled).toContain(reminder.id);
  });

  test("turning reminders off schedules none", async () => {
    await settings.saveLocalSettings({ reminderMinutes: 0 });
    await ring(asking());
    expect(scheduled).toEqual([]);
  });

  test("a bot's own interval beats the global one", async () => {
    await settings.saveLocalSettings({ reminderMinutes: 0 });
    await settings.saveBotBypass("sheldon-11019", { reminderMinutes: 10 });
    const alert = asking({ botId: "sheldon-11019" });
    await urgent.displayUrgent(alert);
    expect(scheduled[1]!.timestamp - scheduled[0]!.timestamp).toBe(10 * 60_000);
    await urgent.clearDisplayedAlert(alert.questionId);
    scheduled.length = 0;
    await ring(asking({ botId: "brow-00007" }));
    expect(scheduled).toEqual([]);
  });

  test("a normal alert never reminds", async () => {
    await ring(asking({ priority: "normal" }));
    expect(scheduled).toEqual([]);
  });
});


describe("presentation lifecycle ordering", () => {
  test("clear during channel creation prevents the notification and card", async () => {
    overlay.allowed = true;
    // A build without the native channel falls back to Notifee's, which is the slow, awaited path.
    overlay.nativeRing = false;
    let release: () => void = () => {};
    channelGate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { channelEntered = resolve; });
    const alert = asking({ priority: "normal" });
    const presenting = urgent.displayUrgent(alert);
    await entered;
    const clearing = urgent.clearDisplayedAlert(alert.questionId);
    release();
    await Promise.all([presenting, clearing]);
    expect(notifications).toEqual([]);
    expect(cards).toEqual([]);
  });

  test("a refused native card falls back to a high-importance notification", async () => {
    overlay.allowed = true;
    overlay.shown = false;
    const alert = asking({ priority: "normal" });
    await urgent.displayUrgent(alert);
    expect(notifications.map((note) => note.channelId)).toEqual(["puck-alerts-card-rd", `${PUSH_CHANNEL_ID}-rd`]);
    await urgent.clearDisplayedAlert(alert.questionId);
  });
});
