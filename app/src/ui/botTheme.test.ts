import { describe, expect, test } from "bun:test";
import { PALETTE, botTheme } from "./botTheme";

const coral = { colour: "coral" as const };
const black = { colour: "black" as const };
const mustard = { colour: "mustard" as const };

describe("PALETTE", () => {
  test("has 14 uniquely named colours", () => {
    expect(PALETTE).toHaveLength(14);
    expect(new Set(PALETTE.map((p) => p.name)).size).toBe(14);
  });
});

describe("botTheme with a normal bot", () => {
  test("light mode uses the base colour at 10% wash and 8% tint", () => {
    const t = botTheme(coral);
    expect(t.bot).toBe("#e24b3a");
    expect(t.botDeep).toBe("#9d261c");
    expect(t.botWash).toBe("rgba(226, 75, 58, 0.1)");
    expect(t.botTint).toBe("rgba(226, 75, 58, 0.08)");
    expect(t.glow).toBe("rgba(226, 75, 58, 0.34)");
    expect(t.glowRing).toBe("#e24b3a");
    expect(t.sendBg).toBe("#e24b3a");
    expect(t.botLight).toBe("rgb(226, 75, 58)");
    expect(t.onBot).toBe("#fff");
    expect(t.blobOutline).toBeNull();
  });

  test("dark mode uses 16% wash and 16% tint", () => {
    const t = botTheme(coral, { dark: true });
    expect(t.botWash).toBe("rgba(226, 75, 58, 0.16)");
    expect(t.botTint).toBe("rgba(226, 75, 58, 0.16)");
    expect(t.blobOutline).toBeNull();
  });

  test("night mode uses a 30% wash glow and 16% tint", () => {
    const t = botTheme(coral, { night: true });
    expect(t.botWash).toBe("rgba(226, 75, 58, 0.3)");
    expect(t.botTint).toBe("rgba(226, 75, 58, 0.16)");
    expect(t.botDeep).toBe("#9d261c");
    expect(t.blobOutline).toBeNull();
  });
});

describe("botTheme with the black bot", () => {
  test("light mode uses neutral greys and no outline", () => {
    const t = botTheme(black);
    expect(t.botWash).toBe("rgba(0, 0, 0, 0.045)");
    expect(t.botTint).toBe("rgba(0, 0, 0, 0.05)");
    expect(t.bot).toBe("#111111");
    expect(t.botDeep).toBe("#000000");
    expect(t.sendBg).toBe("#111111");
    expect(t.botLight).toBe("#D8D4CF");
    expect(t.glow).toBe("rgba(255, 255, 255, 0.10)");
    expect(t.glowRing).toBe("#6E6A66");
    expect(t.onBot).toBe("#fff");
    expect(t.blobOutline).toBeNull();
  });

  test("dark mode uses light greys, a black deep edge and the 2px outline", () => {
    const t = botTheme(black, { dark: true });
    expect(t.botWash).toBe("rgba(255, 255, 255, 0.07)");
    expect(t.botTint).toBe("rgba(255, 255, 255, 0.07)");
    expect(t.botDeep).toBe("#000");
    expect(t.sendBg).toBe("#2A2826");
    expect(t.blobOutline).toBe("#3A3836");
  });

  test("night mode matches dark mode for the black bot", () => {
    const t = botTheme(black, { night: true });
    expect(t.botWash).toBe("rgba(255, 255, 255, 0.07)");
    expect(t.botTint).toBe("rgba(255, 255, 255, 0.07)");
    expect(t.blobOutline).toBe("#3A3836");
  });
});

describe("botTheme text colour on the bot", () => {
  test("uses ink on mustard in light and dark mode", () => {
    expect(botTheme(mustard).onBot).toBe("#1E1B19");
    expect(botTheme(mustard, { dark: true }).onBot).toBe("#1E1B19");
    expect(botTheme(mustard, { night: true }).onBot).toBe("#1E1B19");
  });

  test("uses ink on tangerine, green, rose and brown, and white elsewhere", () => {
    for (const colour of ["tangerine", "green", "rose", "brown"] as const) {
      expect(botTheme({ colour }).onBot).toBe("#1E1B19");
    }
    for (const colour of ["coral", "moss", "teal", "black"] as const) {
      expect(botTheme({ colour }).onBot).toBe("#fff");
    }
  });
});

test("throws on an unknown colour", () => {
  expect(() => botTheme({ colour: "puce" as never })).toThrow("Unknown bot colour");
});
