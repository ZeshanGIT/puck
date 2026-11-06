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
