import { describe, expect, test } from "bun:test";
import {
  bypassDecision,
  clockDateText,
  clockText,
  DEFAULT_LOCAL_SETTINGS,
  isNight,
  loopsFor,
  parseLocalSettings,
  ringSecondsFor,
  ringtoneFor,
  ringtonesInUse,
  URGENT_CHANNEL,
  urgentChannelId,
  withBotBypass,
  withoutBot,
  type LocalSettings,
} from "./localSettings";

const defaults = DEFAULT_LOCAL_SETTINGS;
const asks = { priority: "urgent" as const, bypassDnd: true, bypassSilent: true };

describe("bypassDecision", () => {
  test("default urgent only: an urgent alert that asks gets through", () => {
    expect(bypassDecision(asks, defaults)).toEqual({ dnd: true, silent: true });
  });

  test("an alert that does not ask never gets through, whatever the settings", () => {
    const all: LocalSettings = { ...defaults, bypassDnd: "all", bypassSilent: "all" };
    expect(bypassDecision({ priority: "urgent" }, all)).toEqual({ dnd: false, silent: false });
    expect(bypassDecision({ priority: "urgent", bypassDnd: true }, defaults)).toEqual({ dnd: true, silent: false });
    expect(bypassDecision({ priority: "urgent", bypassSilent: true }, defaults)).toEqual({ dnd: false, silent: true });
  });

  test("urgent only does not let a normal alert through; all does; off stops everything", () => {
    const normal = { priority: "normal" as const, bypassDnd: true, bypassSilent: true };
    expect(bypassDecision(normal, defaults)).toEqual({ dnd: false, silent: false });
    expect(bypassDecision(normal, { ...defaults, bypassDnd: "all", bypassSilent: "all" })).toEqual({
      dnd: true,
      silent: true,
    });
    expect(bypassDecision(asks, { ...defaults, bypassDnd: "off", bypassSilent: "off" })).toEqual({
      dnd: false,
      silent: false,
    });
  });

  test("the two settings are independent", () => {
    expect(bypassDecision(asks, { ...defaults, bypassDnd: "off" })).toEqual({ dnd: false, silent: true });
    expect(bypassDecision(asks, { ...defaults, bypassSilent: "off" })).toEqual({ dnd: true, silent: false });
  });

  test("a bot override wins over the global setting, in either direction", () => {
    const off: LocalSettings = {
      ...defaults,
      bypassDnd: "off",
      bypassSilent: "off",
      bots: { deploy: { dnd: "urgent", silent: "urgent" } },
    };
    expect(bypassDecision(asks, off, "deploy")).toEqual({ dnd: true, silent: true });
    expect(bypassDecision(asks, off, "other")).toEqual({ dnd: false, silent: false });
    expect(bypassDecision(asks, off)).toEqual({ dnd: false, silent: false });

    const on: LocalSettings = { ...defaults, bots: { chatty: { dnd: "off" } } };
    expect(bypassDecision(asks, on, "chatty")).toEqual({ dnd: false, silent: true });
  });
});

describe("ringSecondsFor", () => {
  test("the alert wins, otherwise 60", () => {
    expect(ringSecondsFor(300)).toBe(300);
    expect(ringSecondsFor(undefined)).toBe(60);
    expect(ringSecondsFor(1)).toBe(60);
    expect(ringSecondsFor(Number.NaN)).toBe(60);
  });
});

describe("parseLocalSettings", () => {
  test("falls back to the defaults for nothing, junk and bad fields", () => {
    expect(parseLocalSettings(null)).toEqual(defaults);
    expect(parseLocalSettings("not json")).toEqual(defaults);
    expect(parseLocalSettings("[1]")).toEqual(defaults);
    expect(parseLocalSettings(JSON.stringify({ bypassDnd: "sometimes", reminderMinutes: 99999 }))).toEqual(defaults);
  });

  test("keeps valid fields and drops invalid bot overrides", () => {
    const parsed = parseLocalSettings(
      JSON.stringify({
        bypassDnd: "off",
        bypassSilent: "all",
        normalRingtone: "content://media/internal/audio/media/11",
        urgentRingtone: 7,
        reminderMinutes: 10,
        bots: { a: { dnd: "all", reminderMinutes: 2 }, b: { dnd: "nope", reminderMinutes: 3 }, c: "x" },
      }),
    );
    expect(parsed).toEqual({
      theme: "system",
      bypassDnd: "off",
      bypassSilent: "all",
      normalRingtone: "content://media/internal/audio/media/11",
      urgentRingtone: "",
      loopNormal: false,
      loopUrgent: false,
      reminderMinutes: 10,
      bots: { a: { dnd: "all", reminderMinutes: 2 } },
    });
  });

  test("the theme is System unless a valid Light or Dark was stored", () => {
    expect(parseLocalSettings(null).theme).toBe("system");
    expect(parseLocalSettings(JSON.stringify({ theme: "dark" })).theme).toBe("dark");
    expect(parseLocalSettings(JSON.stringify({ theme: "light" })).theme).toBe("light");
    expect(parseLocalSettings(JSON.stringify({ theme: "night" })).theme).toBe("system");
  });

  test("never hands out the shared defaults object", () => {
    parseLocalSettings(null).bots.x = { dnd: "all" };
    expect(defaults.bots).toEqual({});
  });
});

describe("urgentChannelId", () => {
  test("one channel per decision, the POC's id for the normal case", () => {
    expect(urgentChannelId({ dnd: false, silent: false }, true)).toBe("puck-urgent");
    expect(urgentChannelId({ dnd: true, silent: false }, true)).toBe(URGENT_CHANNEL.dnd);
    expect(urgentChannelId({ dnd: false, silent: true }, true)).toBe(URGENT_CHANNEL.alarm);
    expect(urgentChannelId({ dnd: true, silent: true }, true)).toBe(URGENT_CHANNEL.bypass);
  });

  test("without native alarm channels the silent bypass is dropped, the DND one stays", () => {
    expect(urgentChannelId({ dnd: false, silent: true }, false)).toBe("puck-urgent");
    expect(urgentChannelId({ dnd: true, silent: true }, false)).toBe(URGENT_CHANNEL.dnd);
  });
});

describe("isNight", () => {
  test("is night from 22:00 up to 07:00 local time", () => {
    expect(isNight(new Date(2026, 10, 6, 22, 0))).toBe(true);
    expect(isNight(new Date(2026, 10, 6, 23, 59))).toBe(true);
    expect(isNight(new Date(2026, 10, 7, 0, 0))).toBe(true);
    expect(isNight(new Date(2026, 10, 7, 6, 59))).toBe(true);
    expect(isNight(new Date(2026, 10, 7, 7, 0))).toBe(false);
    expect(isNight(new Date(2026, 10, 7, 12, 0))).toBe(false);
    expect(isNight(new Date(2026, 10, 7, 21, 59))).toBe(false);
  });
});

describe("clock text", () => {
  test("matches the prototype's lock clock and date", () => {
    const morning = new Date(2026, 10, 7, 6, 0);
    expect(clockText(morning)).toBe("6:00");
    expect(clockDateText(morning)).toBe("Saturday, 7 November");
    expect(clockText(new Date(2026, 10, 6, 21, 47))).toBe("21:47");
    expect(clockText(new Date(2026, 10, 7, 0, 5))).toBe("0:05");
  });
});

describe("per-bot overrides", () => {
  test("setting one adds an entry that bypassDecision then uses", () => {
    const next = withBotBypass(defaults, "deploy-00001", { dnd: "all", silent: "off" });
    expect(next.bots["deploy-00001"]).toEqual({ dnd: "all", silent: "off" });
    expect(bypassDecision({ priority: "normal", bypassDnd: true, bypassSilent: true }, next, "deploy-00001")).toEqual({
      dnd: true,
      silent: false,
    });
    // Another bot still follows the global setting.
    expect(bypassDecision(asks, next, "other-00002")).toEqual({ dnd: true, silent: true });
  });

  test("one setting changes without touching the other; null goes back to the default", () => {
    const a = withBotBypass(defaults, "deploy-00001", { dnd: "all" });
    const b = withBotBypass(a, "deploy-00001", { silent: "off" });
    expect(b.bots["deploy-00001"]).toEqual({ dnd: "all", silent: "off" });
    const c = withBotBypass(b, "deploy-00001", { dnd: null });
    expect(c.bots["deploy-00001"]).toEqual({ silent: "off" });
    expect(withBotBypass(c, "deploy-00001", {}).bots["deploy-00001"]).toEqual({ silent: "off" });
  });

  test("a bot with nothing left has no entry, and the input is not changed", () => {
    const a = withBotBypass(defaults, "deploy-00001", { dnd: "all" });
    const b = withBotBypass(a, "deploy-00001", { dnd: null });
    expect(b.bots).toEqual({});
    expect(a.bots["deploy-00001"]).toEqual({ dnd: "all" });
    expect(defaults.bots).toEqual({});
  });

  test("the result survives storing and reading back", () => {
    const next = withBotBypass(defaults, "deploy-00001", { dnd: "urgent", silent: "all" });
    expect(parseLocalSettings(JSON.stringify(next)).bots).toEqual({ "deploy-00001": { dnd: "urgent", silent: "all" } });
  });

  test("a removed bot's overrides go", () => {
    const a = withBotBypass(defaults, "deploy-00001", { dnd: "all" });
    expect(withoutBot(a, "deploy-00001").bots).toEqual({});
    expect(withoutBot(a, "missing-00009")).toBe(a);
  });
});

describe("per-bot overrides reach the decision and the channel", () => {
  const settings = withBotBypass(defaults, "deploy-00001", { dnd: "all", silent: "off" });
  const normalAsks = { priority: "normal" as const, bypassDnd: true, bypassSilent: true };

  test("with the bot id the bot's override decides; without it the global setting does", () => {
    expect(bypassDecision(normalAsks, settings, "deploy-00001")).toEqual({ dnd: true, silent: false });
    expect(bypassDecision(normalAsks, settings)).toEqual({ dnd: false, silent: false });
    expect(bypassDecision(normalAsks, settings, "unknown-00009")).toEqual({ dnd: false, silent: false });
  });

  test("an override can also take a bypass away that the global setting would give", () => {
    const stricter = withBotBypass(defaults, "quiet-00002", { dnd: "off", silent: "off" });
    expect(bypassDecision(asks, stricter, "quiet-00002")).toEqual({ dnd: false, silent: false });
    expect(bypassDecision(asks, stricter)).toEqual({ dnd: true, silent: true });
  });

  test("the decision picks one of the existing channels, so no new channel is needed", () => {
    const known = new Set<string>(Object.values(URGENT_CHANNEL));
    for (const bot of ["deploy-00001", "quiet-00002", undefined]) {
      for (const priority of ["normal", "urgent"] as const) {
        const decision = bypassDecision({ priority, bypassDnd: true, bypassSilent: true }, settings, bot);
        for (const alarm of [true, false]) expect(known.has(urgentChannelId(decision, alarm))).toBe(true);
      }
    }
    const decision = bypassDecision(normalAsks, settings, "deploy-00001");
    // Through Do Not Disturb but not silent mode: the existing "dnd" channel, whether or not alarm channels work.
    expect(urgentChannelId(decision, true)).toBe(URGENT_CHANNEL.dnd);
    expect(urgentChannelId(decision, false)).toBe(URGENT_CHANNEL.dnd);
  });
});

describe("ringtones", () => {
  const A = "content://media/internal/audio/media/11";
  const B = "content://media/internal/audio/media/22";
  const C = "content://media/internal/audio/media/33";

  test("an alert plays the bot's own ringtone for its kind, else the global one", () => {
    const settings: LocalSettings = {
      ...defaults,
      normalRingtone: A,
      urgentRingtone: B,
      bots: { chatty: { urgentRingtone: C }, quiet: { normalRingtone: "" } },
    };
    expect(ringtoneFor(settings, undefined, "normal")).toBe(A);
    expect(ringtoneFor(settings, "other", "urgent")).toBe(B);
    expect(ringtoneFor(settings, "chatty", "urgent")).toBe(C);
    expect(ringtoneFor(settings, "chatty", "normal")).toBe(A);
    // An empty choice is the phone's own ringtone, not "follow the global one".
    expect(ringtoneFor(settings, "quiet", "normal")).toBe("");
  });

  test("every ringtone in use is listed once, the bots' own included", () => {
    const settings: LocalSettings = {
      ...defaults,
      normalRingtone: A,
      urgentRingtone: B,
      bots: { x: { urgentRingtone: C }, y: { urgentRingtone: B }, z: { reminderMinutes: 2 } },
    };
    expect(ringtonesInUse(settings)).toEqual({ normal: [A], urgent: [B, C] });
  });

  test("a bot's ringtones are stored, dropped when invalid, and can be reset", () => {
    const parsed = parseLocalSettings(
      JSON.stringify({ bots: { a: { normalRingtone: A, urgentRingtone: 5 }, b: { urgentRingtone: "" } } }),
    );
    expect(parsed.bots).toEqual({ a: { normalRingtone: A }, b: { urgentRingtone: "" } });
    const set = withBotBypass(defaults, "a", { urgentRingtone: B });
    expect(set.bots.a).toEqual({ urgentRingtone: B });
    expect(withBotBypass(set, "a", { urgentRingtone: null }).bots).toEqual({});
  });

  test("repeating the ringtone is off unless it was turned on, for each kind of alert on its own", () => {
    expect(parseLocalSettings(null)).toMatchObject({ loopNormal: false, loopUrgent: false });
    const urgentOnly = parseLocalSettings(JSON.stringify({ loopUrgent: true }));
    expect(urgentOnly).toMatchObject({ loopNormal: false, loopUrgent: true });
    expect(loopsFor(urgentOnly, "urgent")).toBe(true);
    expect(loopsFor(urgentOnly, "normal")).toBe(false);
    expect(parseLocalSettings(JSON.stringify({ loopNormal: "yes" })).loopNormal).toBe(false);
  });

  test("a bot's own repeat choice beats the global one, for its own kind of alert, and can be reset", () => {
    const settings: LocalSettings = { ...defaults, loopNormal: true, bots: { chatty: { loopUrgent: true, loopNormal: false } } };
    expect(loopsFor(settings, "normal", "chatty")).toBe(false);
    expect(loopsFor(settings, "urgent", "chatty")).toBe(true);
    expect(loopsFor(settings, "normal", "other")).toBe(true);
    expect(loopsFor(settings, "urgent")).toBe(false);
    // Off for a bot is its own choice, not "follow the global one".
    expect(parseLocalSettings(JSON.stringify({ bots: { a: { loopNormal: false } } })).bots).toEqual({ a: { loopNormal: false } });
    const reset = withBotBypass(settings, "chatty", { loopNormal: null, loopUrgent: null });
    expect(reset.bots).toEqual({});
    expect(loopsFor(reset, "normal", "chatty")).toBe(true);
  });
});
