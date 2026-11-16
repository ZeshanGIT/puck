import { afterEach, describe, expect, test } from "bun:test";
import { BOT_COLOURS, BOT_SHAPES } from "@puck/shared";
import { SHAPES } from "./blobShapes";
import { botLook } from "./botLook";
import { botLooksVersion, knownLook, parseBotLooks, rememberBotLooks, resetBotLooksForTest, storedLook } from "./botLookStore";
import { PALETTE } from "./botTheme";

afterEach(() => resetBotLooksForTest());

describe("the shapes and colours a bot can choose", () => {
  test("the app draws every shape and colour the backend accepts, and no others", () => {
    expect(Object.keys(SHAPES).sort()).toEqual([...BOT_SHAPES].sort());
    expect(PALETTE.map((entry) => entry.name).sort()).toEqual([...BOT_COLOURS].sort());
  });
});

describe("botLookStore", () => {
  test("a bot's chosen colour and shape win over the ones derived from its id", () => {
    const before = botLook({ botId: "grokbot-12345", botName: "grokbot" });
    const shape = before.shape === "cloud" ? "hex" : "cloud";
    const colour = before.colour === "violet" ? "teal" : "violet";
    rememberBotLooks([{ botId: "grokbot-12345", colour, shape }]);
    expect(botLook({ botId: "grokbot-12345", botName: "grokbot" })).toMatchObject({ colour, shape, tilt: before.tilt });
  });

  test("an explicit colour or shape still wins over the remembered one", () => {
    rememberBotLooks([{ botId: "grokbot-12345", colour: "violet", shape: "cloud" }]);
    expect(botLook({ botId: "grokbot-12345", botName: "grokbot", shape: "bean" })).toMatchObject({ colour: "violet", shape: "bean" });
  });

  test("only a change bumps the version; a bot gone from the list is forgotten", () => {
    rememberBotLooks([{ botId: "a-11111", colour: "coral", shape: null }]);
    const first = botLooksVersion();
    rememberBotLooks([{ botId: "a-11111", colour: "coral", shape: null }]);
    expect(botLooksVersion()).toBe(first);
    rememberBotLooks([]);
    expect(botLooksVersion()).toBe(first + 1);
    expect(knownLook("a-11111")).toBeUndefined();
  });

  test("names this build does not know are dropped, not drawn", () => {
    expect(storedLook({ colour: "purple", shape: "star" })).toEqual({});
    expect(storedLook({ colour: "moss", shape: "bean" })).toEqual({ colour: "moss", shape: "bean" });
  });

  test("the saved form reads back, and anything unreadable is empty", () => {
    const map = parseBotLooks(JSON.stringify([["a-11111", { colour: "sky", shape: "hex" }], ["bad"], 3]));
    expect([...map.entries()]).toEqual([["a-11111", { colour: "sky", shape: "hex" }]]);
    expect(parseBotLooks("{oops").size).toBe(0);
    expect(parseBotLooks(null).size).toBe(0);
  });
});
