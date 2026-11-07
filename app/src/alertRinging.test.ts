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
  test("normal alerts ring on the shared alerts channel without insistent sound", () => {
    const plan = alertRingingPlan(
      { priority: "normal", bypassDnd: true, bypassSilent: true },
      { ...DEFAULT_LOCAL_SETTINGS, bypassDnd: "all", bypassSilent: "all" },
      undefined,
      true,
    );
    expect(plan).toEqual({
      channelId: PUSH_CHANNEL_ID,
      insistent: false,
      timeoutMs: 60_000,
      useAlarmChannel: false,
      bypassDndOnChannel: false,
    });
  });

  test("urgent alerts still use urgent bypass channels", () => {
    const plan = alertRingingPlan(urgentAsking, DEFAULT_LOCAL_SETTINGS, undefined, true);
    expect(plan.channelId).toBe(URGENT_CHANNEL.bypass);
    expect(plan.insistent).toBe(true);
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
});
