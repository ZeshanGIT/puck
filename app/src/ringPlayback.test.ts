import { describe, expect, test } from "bun:test";
import { puckRing } from "./ringPlayback";

const none = { dnd: false, silent: false };
const normal = { ringer: "normal" as const, dnd: false };

describe("puckRing", () => {
  test("an ordinary phone: rings on the ring volume", () => {
    expect(puckRing(none, normal)).toEqual({ play: true, stream: "ring" });
  });

  test("silent or vibrate holds back an alert that may not ring in silent mode", () => {
    expect(puckRing(none, { ringer: "silent", dnd: false })).toEqual({ play: false });
    expect(puckRing(none, { ringer: "vibrate", dnd: false })).toEqual({ play: false });
    expect(puckRing({ dnd: true, silent: false }, { ringer: "vibrate", dnd: false })).toEqual({ play: false });
  });

  test("an alert allowed through silent mode rings on the alarm volume, in silent mode or not", () => {
    const silent = { dnd: false, silent: true };
    expect(puckRing(silent, { ringer: "silent", dnd: false })).toEqual({ play: true, stream: "alarm" });
    expect(puckRing(silent, normal)).toEqual({ play: true, stream: "alarm" });
  });

  test("Do Not Disturb holds back an alert not allowed through it, and lets an allowed one ring as an alarm", () => {
    expect(puckRing(none, { ringer: "normal", dnd: true })).toEqual({ play: false });
    expect(puckRing({ dnd: false, silent: true }, { ringer: "normal", dnd: true })).toEqual({ play: false });
    expect(puckRing({ dnd: true, silent: false }, { ringer: "normal", dnd: true })).toEqual({ play: true, stream: "alarm" });
  });

  test("both on: an alert allowed through both rings as an alarm", () => {
    expect(puckRing({ dnd: true, silent: true }, { ringer: "silent", dnd: true })).toEqual({ play: true, stream: "alarm" });
  });
});
