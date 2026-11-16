import { describe, expect, test } from "bun:test";
import { floatProgress, floatStepKey, floatStepLine, liveFloatSpec } from "./liveFloatModel";
import { liveFloatFor, parseLocalSettings, withBotBypass } from "./localSettings";

const push = {
  activityId: "k1",
  botId: "mac-79521",
  botName: "mac",
  title: "Release 0.4.1",
  currentStep: "Test",
  note: "120 of 312",
  state: "running" as const,
  startedAt: 1,
  updatedAt: 2,
  colour: "sky" as const,
  stepIndex: 1,
  stepCount: 3,
};

describe("the floating card", () => {
  test("step line, ring and the key a hide lasts for", () => {
    expect(floatStepLine(push)).toBe("Test · 1 to go");
    expect(floatStepLine({ ...push, state: "failed" })).toBe("Didn't finish");
    expect(floatStepLine({ ...push, currentStep: "", stepIndex: null, stepCount: null })).toBe("Working");
    expect(floatProgress(push)).toBeCloseTo(1 / 3);
    expect(floatProgress({ ...push, stepIndex: null, stepCount: null })).toBeNull();
    expect(floatProgress({ ...push, state: "done" })).toBe(1);
    // Notes do not change the key; a new step does.
    expect(floatStepKey(push)).toBe(floatStepKey({ ...push }));
    expect(floatStepKey(push)).not.toBe(floatStepKey({ ...push, stepIndex: 2, currentStep: "Upload" }));
  });

  test("carries the bot's look and Android-readable colours", () => {
    const spec = liveFloatSpec(push, { name: "mac", colour: "sky", shape: "cloud", tilt: 3 }, false);
    expect(spec).toMatchObject({ activityId: "k1", note: "120 of 312", stepLine: "Test · 1 to go", blobTilt: 3 });
    for (const key of ["background", "ink", "ink2", "botColour", "blobFill", "ok", "danger"] as const) {
      expect(spec[key]).toMatch(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
    }
  });

  test("off for every bot until turned on for one", () => {
    const settings = parseLocalSettings(null);
    expect(liveFloatFor(settings, "mac-79521")).toBe(false);
    const on = withBotBypass(settings, "mac-79521", { liveFloat: true });
    expect(liveFloatFor(on, "mac-79521")).toBe(true);
    expect(liveFloatFor(on, "other-12345")).toBe(false);
    expect(liveFloatFor(withBotBypass(on, "mac-79521", { liveFloat: null }), "mac-79521")).toBe(false);
    expect(liveFloatFor(parseLocalSettings(JSON.stringify(on)), "mac-79521")).toBe(true);
  });
});
