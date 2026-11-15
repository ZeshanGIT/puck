import { describe, expect, test } from "bun:test";
import { ringChannelId, ringtoneKey, staleRingChannelIds } from "./ringChannels";

const NOTIFICATION_TONE = "content://media/internal/audio/media/11";
const RINGTONE = "content://media/internal/audio/media/22";

describe("ringtoneKey", () => {
  test("the phone's own ringtone has a fixed key; others are stable and differ", () => {
    expect(ringtoneKey("")).toBe("d");
    expect(ringtoneKey(RINGTONE)).toBe(ringtoneKey(RINGTONE));
    expect(ringtoneKey(RINGTONE)).not.toBe(ringtoneKey(NOTIFICATION_TONE));
    expect(ringtoneKey(RINGTONE)).toMatch(/^[0-9a-z]+$/);
  });
});

describe("ringChannelId", () => {
  test("carries the ringtone, so a new ringtone is a new channel", () => {
    expect(ringChannelId("puck-urgent-dnd-card", "")).toBe("puck-urgent-dnd-card-rd");
    expect(ringChannelId("puck-alerts", RINGTONE)).toBe(`puck-alerts-r${ringtoneKey(RINGTONE)}`);
  });
});

describe("staleRingChannelIds", () => {
  const chosen = { normal: [""], urgent: [RINGTONE] };
  const urgentKey = ringtoneKey(RINGTONE);

  test("lists channels made for an earlier ringtone, per kind", () => {
    const ids = [
      "puck-alerts-rd",
      "puck-alerts-card-rd",
      `puck-alerts-r${ringtoneKey(NOTIFICATION_TONE)}`,
      `puck-urgent-bypass-r${urgentKey}`,
      "puck-urgent-bypass-rd",
      `puck-urgent-dnd-card-r${ringtoneKey(NOTIFICATION_TONE)}`,
    ];
    expect(staleRingChannelIds(ids, chosen)).toEqual([
      `puck-alerts-r${ringtoneKey(NOTIFICATION_TONE)}`,
      "puck-urgent-bypass-rd",
      `puck-urgent-dnd-card-r${ringtoneKey(NOTIFICATION_TONE)}`,
    ]);
  });

  test("lists the ringing channels from before the ringtone was part of the id", () => {
    expect(
      staleRingChannelIds(["puck-urgent", "puck-urgent-dnd", "puck-urgent-alarm-card", "puck-urgent-bypass", "puck-alerts-card"], chosen),
    ).toEqual(["puck-urgent", "puck-urgent-dnd", "puck-urgent-alarm-card", "puck-urgent-bypass", "puck-alerts-card"]);
  });

  test("keeps the channels of every ringtone in use, a bot's own included", () => {
    const other = ringtoneKey(NOTIFICATION_TONE);
    const ids = [`puck-urgent-dnd-r${urgentKey}`, `puck-urgent-dnd-r${other}`, `puck-alerts-r${other}`];
    expect(staleRingChannelIds(ids, { normal: [""], urgent: [RINGTONE, NOTIFICATION_TONE] })).toEqual([`puck-alerts-r${other}`]);
    expect(staleRingChannelIds(ids, { normal: ["", NOTIFICATION_TONE], urgent: [RINGTONE] })).toEqual([`puck-urgent-dnd-r${other}`]);
  });

  test("never lists puck-alerts itself, the quiet channels or other apps' channels", () => {
    expect(
      staleRingChannelIds(["puck-alerts", "puck-urgent-soft", "puck-urgent-waiting", "puck-live", "other"], chosen),
    ).toEqual([]);
  });
});
