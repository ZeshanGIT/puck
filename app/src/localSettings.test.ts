import { describe, expect, test } from "bun:test";
import {
  bypassDecision,
  clockDateText,
  clockText,
  DEFAULT_LOCAL_SETTINGS,
  isNight,
  parseLocalSettings,
  ringSecondsFor,
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
  test("the alert wins, then the setting, then 60", () => {
    expect(ringSecondsFor(300, defaults)).toBe(300);
    expect(ringSecondsFor(undefined, defaults)).toBe(60);
    expect(ringSecondsFor(undefined, { ...defaults, ringSeconds: 120 })).toBe(120);
    expect(ringSecondsFor(1, defaults)).toBe(60);
    expect(ringSecondsFor(Number.NaN, defaults)).toBe(60);
  });
});

describe("parseLocalSettings", () => {
  test("falls back to the defaults for nothing, junk and bad fields", () => {
    expect(parseLocalSettings(null)).toEqual(defaults);
    expect(parseLocalSettings("not json")).toEqual(defaults);
    expect(parseLocalSettings("[1]")).toEqual(defaults);
    expect(parseLocalSettings(JSON.stringify({ bypassDnd: "sometimes", ringSeconds: 99999 }))).toEqual(defaults);
  });

  test("keeps valid fields and drops invalid bot overrides", () => {
    const parsed = parseLocalSettings(
      JSON.stringify({
        bypassDnd: "off",
        bypassSilent: "all",
        ringSeconds: 120,
        bots: { a: { dnd: "all" }, b: { dnd: "nope" }, c: "x" },
      }),
    );
    expect(parsed).toEqual({ bypassDnd: "off", bypassSilent: "all", ringSeconds: 120, bots: { a: { dnd: "all" } } });
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
