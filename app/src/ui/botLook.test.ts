import { describe, expect, test } from "bun:test";
import { PALETTE } from "./botTheme";
import { SAMPLE_BOTS, SHAPES } from "./blobShapes";
import { botLook } from "./botLook";

const paletteNames: string[] = PALETTE.map((p) => p.name);
const shapeNames = Object.keys(SHAPES);

describe("botLook", () => {
  test("is deterministic for the same bot", () => {
    const bot = { botId: "mystery-bot-12345", botName: "Mystery" };
    expect(botLook(bot)).toEqual(botLook({ ...bot }));
  });

  test("sample names map to the sample bots, whatever the id", () => {
    expect(botLook({ botId: "sheldon-23648", botName: "Sheldon" })).toEqual(SAMPLE_BOTS.sheldon);
    expect(botLook({ botId: "anything-00001", botName: "brow" })).toEqual({ ...SAMPLE_BOTS.brow, name: "brow" });
    expect(botLook({ botId: "x-00001", botName: " Grok Bot " }).colour).toBe("black");
    expect(botLook({ botId: "x-00002", botName: "Deploy Watch" }).shape).toBe("hex");
    for (const key of ["puck", "cortana", "deploy", "grok"] as const) {
      const look = botLook({ botId: `${key}-00001`, botName: key });
      expect(look.colour).toBe(SAMPLE_BOTS[key].colour);
      expect(look.shape).toBe(SAMPLE_BOTS[key].shape);
      expect(look.tilt).toBe(SAMPLE_BOTS[key].tilt);
    }
  });

  test("unknown names give a valid palette colour, shape and tilt", () => {
    for (let i = 0; i < 200; i++) {
      const look = botLook({ botId: `bot-${i}-${i * 7919}`, botName: `Bot ${i}` });
      expect(paletteNames).toContain(look.colour);
      expect(shapeNames).toContain(look.shape);
      expect(look.tilt).toBeGreaterThanOrEqual(-7);
      expect(look.tilt).toBeLessThanOrEqual(6);
      expect(look.name).toBe(`Bot ${i}`);
    }
  });

  test("different ids spread over several colours and shapes", () => {
    const looks = Array.from({ length: 100 }, (_, i) => botLook({ botId: `spread-${i}`, botName: "Spread" }));
    expect(new Set(looks.map((l) => l.colour)).size).toBeGreaterThan(5);
    expect(new Set(looks.map((l) => l.shape)).size).toBeGreaterThan(2);
  });

  test("an explicit colour or shape wins over the sample and the hash", () => {
    const look = botLook({ botId: "sheldon-23648", botName: "Sheldon", colour: "teal", shape: "cloud" });
    expect(look.colour).toBe("teal");
    expect(look.shape).toBe("cloud");
    expect(look.tilt).toBe(SAMPLE_BOTS.sheldon.tilt);
  });
});
