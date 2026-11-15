import { describe, expect, test } from "bun:test";
import { PUSH_CHANNEL_ID } from "@puck/shared";
import { alertRingingPlan } from "./alertRinging";
import { DEFAULT_LOCAL_SETTINGS, URGENT_CHANNEL } from "./localSettings";

const urgentAsking = {
  priority: "urgent" as const,
  bypassDnd: true,
  bypassSilent: true,
};

describe("alertRingingPlan", () => {
  test("by default a normal alert rings on the shared alerts channel, even when it asks to bypass", () => {
    const plan = alertRingingPlan({ priority: "normal", bypassDnd: true, bypassSilent: true }, DEFAULT_LOCAL_SETTINGS, undefined, true);
    expect(plan).toEqual({
      channelId: PUSH_CHANNEL_ID,
      ringSeconds: 60,
      useAlarmChannel: false,
      bypassDndOnChannel: false,
    });
  });

  test("a normal alert bypasses only when its own switches allow it, never because urgent ones may", () => {
    const asking = { priority: "normal" as const, bypassDnd: true, bypassSilent: true };
    const urgentOnly = alertRingingPlan(asking, { ...DEFAULT_LOCAL_SETTINGS, bypassDnd: "urgent", bypassSilent: "urgent" }, undefined, true);
    expect(urgentOnly.channelId).toBe(PUSH_CHANNEL_ID);
    const normalOnly = alertRingingPlan(asking, { ...DEFAULT_LOCAL_SETTINGS, bypassDnd: "normal", bypassSilent: "off" }, undefined, true);
    expect(normalOnly).toMatchObject({ channelId: `${PUSH_CHANNEL_ID}-dnd`, bypassDndOnChannel: true, useAlarmChannel: false });
    const all = alertRingingPlan(asking, { ...DEFAULT_LOCAL_SETTINGS, bypassDnd: "all", bypassSilent: "all" }, undefined, true);
    expect(all).toMatchObject({ channelId: `${PUSH_CHANNEL_ID}-bypass`, bypassDndOnChannel: true, useAlarmChannel: true });
    // Not asked: no bypass, whatever the settings.
    expect(alertRingingPlan({ priority: "normal" }, { ...DEFAULT_LOCAL_SETTINGS, bypassDnd: "all" }, undefined, true).channelId).toBe(PUSH_CHANNEL_ID);
  });

  test("normal only does not let urgent alerts through", () => {
    const plan = alertRingingPlan(urgentAsking, { ...DEFAULT_LOCAL_SETTINGS, bypassDnd: "normal", bypassSilent: "normal" }, undefined, true);
    expect(plan.bypassDndOnChannel).toBe(false);
    expect(plan.useAlarmChannel).toBe(false);
  });

  test("urgent alerts still use urgent bypass channels", () => {
    const plan = alertRingingPlan(urgentAsking, DEFAULT_LOCAL_SETTINGS, undefined, true);
    expect(plan.channelId).toBe(URGENT_CHANNEL.bypass);
    expect(plan.useAlarmChannel).toBe(true);
  });

  test("urgent with bypass off uses the plain urgent channel", () => {
    const plan = alertRingingPlan(
      urgentAsking,
      { ...DEFAULT_LOCAL_SETTINGS, bypassDnd: "off", bypassSilent: "off" },
      undefined,
      true,
    );
    expect(plan.channelId).toBe(URGENT_CHANNEL.plain);
  });

  test("the alert's own ring length is kept for the card and the voice", () => {
    expect(alertRingingPlan({ ...urgentAsking, ringSeconds: 45 }, DEFAULT_LOCAL_SETTINGS, undefined, true).ringSeconds).toBe(45);
  });
});
