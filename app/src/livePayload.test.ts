import { describe, expect, test } from "bun:test";
import { livePush } from "./livePayload";

const PUSH = {
  kind: "live",
  activityId: "k17abc",
  botId: "sheldon-11019",
  botName: "Sheldon",
  title: "Fixing the swipe arm bug",
  currentStep: "Running the tests",
  state: "running",
  startedAt: "1731000000000",
  updatedAt: "1731000120000",
  colour: "coral",
  stepIndex: "2",
  stepCount: "5",
};

describe("livePush", () => {
  test("reads Expo's dataString, a nested data object and a bare payload", () => {
    const expected = {
      activityId: "k17abc",
      botId: "sheldon-11019",
      botName: "Sheldon",
      title: "Fixing the swipe arm bug",
      currentStep: "Running the tests",
      state: "running",
      startedAt: 1731000000000,
      updatedAt: 1731000120000,
      colour: "coral",
      stepIndex: 2,
      stepCount: 5,
    };
    expect(livePush({ data: { dataString: JSON.stringify(PUSH) } })).toEqual(expected);
    expect(livePush({ data: PUSH })).toEqual(expected);
    expect(livePush(PUSH)).toEqual(expected);
  });

  test("a task with no steps has no track, and colour is optional", () => {
    const { stepIndex: _i, stepCount: _c, colour: _col, ...bare } = PUSH;
    expect(livePush(bare)).toMatchObject({ stepIndex: null, stepCount: null, colour: null });
    expect(livePush({ ...PUSH, stepIndex: "1", stepCount: undefined })).toMatchObject({ stepIndex: null, stepCount: null });
  });

  test("a step index past the end is held to the last step", () => {
    expect(livePush({ ...PUSH, stepIndex: "9", stepCount: "5" })).toMatchObject({ stepIndex: 4, stepCount: 5 });
  });

  test("an empty current step is allowed; a colour outside the palette is dropped", () => {
    expect(livePush({ ...PUSH, currentStep: "" })?.currentStep).toBe("");
    expect(livePush({ ...PUSH, colour: "chartreuse" })?.colour).toBeNull();
  });

  test("ignores other pushes and anything missing what the notification needs", () => {
    expect(livePush({ ...PUSH, kind: "dismiss" })).toBeNull();
    expect(livePush({ ...PUSH, activityId: "" })).toBeNull();
    expect(livePush({ ...PUSH, botId: "nope" })).toBeNull();
    expect(livePush({ ...PUSH, title: " " })).toBeNull();
    expect(livePush({ ...PUSH, state: "paused" })).toBeNull();
    expect(livePush({ ...PUSH, startedAt: "soon" })).toBeNull();
    expect(livePush({ ...PUSH, updatedAt: undefined })).toBeNull();
    expect(livePush({ data: { dataString: "{not json" } })).toBeNull();
    expect(livePush(null)).toBeNull();
  });
});
