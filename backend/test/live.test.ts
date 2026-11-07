import { describe, expect, test } from "bun:test";
import { LIVE_KIND } from "@puck/shared";
import { fcmLiveMessage } from "../convex/lib/fcm";
import { liveSendMode } from "../convex/lib/liveRules";

const NOW = 1_000_000;
const base = {
  pushToken: "token-aaaaaaaaaaaaaaaaaaaa",
  activityId: "act_1",
  botId: "sheldon-23648",
  botName: "sheldon",
  colour: "indigo",
  title: "Fix the build",
  currentStep: "Running the tests",
  state: "running",
  stepIndex: 2,
  stepCount: 4,
  startedAt: NOW - 300_000,
  updatedAt: NOW,
};

describe("fcmLiveMessage", () => {
  test("is data-only at normal priority, with strings and the fields the notification needs", () => {
    const body = fcmLiveMessage(base);
    expect(body.message.token).toBe(base.pushToken);
    expect(body.message.android.priority).toBe("NORMAL");
    expect("notification" in body.message).toBe(false);
    expect(body.message.data).toEqual({
      kind: LIVE_KIND,
      activityId: "act_1",
      botId: "sheldon-23648",
      botName: "sheldon",
      title: "Fix the build",
      currentStep: "Running the tests",
      state: "running",
      startedAt: String(NOW - 300_000),
      updatedAt: String(NOW),
      colour: "indigo",
      stepIndex: "2",
      stepCount: "4",
    });
  });

  test("leaves out the track fields for an activity without steps", () => {
    const body = fcmLiveMessage({ ...base, colour: null, stepIndex: null, stepCount: null });
    expect(Object.keys(body.message.data).sort()).toEqual(
      ["activityId", "botId", "botName", "currentStep", "kind", "startedAt", "state", "title", "updatedAt"].sort(),
    );
  });

  test("never carries a secret or a webhook", () => {
    const text = JSON.stringify(fcmLiveMessage(base));
    expect(text).not.toMatch(/Bearer|webhook|secret/i);
  });
});

describe("liveSendMode", () => {
  test("a bot with an owner pushes, unless it is muted now", () => {
    expect(liveSendMode({}, true, NOW)).toBe("push");
    expect(liveSendMode({ mutedUntil: NOW + 60_000 }, true, NOW)).toBe("muted");
    expect(liveSendMode({ mutedUntil: NOW }, true, NOW)).toBe("push");
  });

  test("a bot with no owner never pushes", () => {
    expect(liveSendMode({}, false, NOW)).toBe("no owner");
  });
});
