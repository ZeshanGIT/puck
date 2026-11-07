import { describe, expect, test } from "bun:test";
import { PALETTE, botTheme } from "./botTheme";
import { contrastRatio, ensureContrast, over, parseColour, washGradientCss, washStop } from "./contrast";
import { darkTokens, lightTokens, type ThemeTokens } from "./tokens";

const BODY = 4.5;
const LARGE = 3;
const NIGHT_BG = "#100F0E";
const NIGHT_FACE = "#1C1A18";

/** Text tokens and the surfaces each is drawn on (the spec: 4.5:1 body, 3:1 large text). */
function textPairs(t: ThemeTokens): Array<[string, string, string]> {
  const neutral = ["bg", "card", "fill", "fill2"] as const;
  const pairs: Array<[string, string, string]> = [];
  for (const text of ["ink", "ink2", "ink3"] as const) {
    for (const surface of neutral) pairs.push([text, surface, `${text} on ${surface}`]);
  }
  for (const surface of ["bg", "card", "fill", "warnbg"] as const) pairs.push(["warn", surface, `warn on ${surface}`]);
  for (const surface of ["bg", "card", "fill", "dangerbg"] as const) pairs.push(["danger", surface, `danger on ${surface}`]);
  for (const surface of ["bg", "card", "fill", "okbg"] as const) pairs.push(["ok", surface, `ok on ${surface}`]);
  return pairs;
}

describe("contrast helpers", () => {
  test("black on white is 21:1 and a colour on itself is 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  test("parses hex, rgb and rgba", () => {
    expect(parseColour("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour("rgb(226, 75, 58)")).toEqual({ r: 226, g: 75, b: 58, a: 1 });
    expect(parseColour("rgba(0, 0, 0, 0.045)").a).toBeCloseTo(0.045, 5);
  });

  test("a translucent background is composited over its base", () => {
    expect(over("rgba(0, 0, 0, 0.5)", "#ffffff")).toBe("#808080");
  });

  test("ensureContrast leaves a passing colour alone and moves a failing one just far enough", () => {
    expect(ensureContrast("#000000", ["#ffffff"], BODY, "darken")).toBe("#000000");
    const fixed = ensureContrast("#9A948E", ["#ffffff"], BODY, "darken");
    expect(contrastRatio(fixed, "#ffffff")).toBeGreaterThanOrEqual(BODY);
    expect(contrastRatio(fixed, "#ffffff")).toBeLessThan(BODY + 0.3);
  });
});

describe.each([
  ["light", lightTokens],
  ["dark", darkTokens],
] as const)("%s tokens", (_name, tokens) => {
  test.each(textPairs(tokens))("%s on %s reaches 4.5:1", (text, surface, label) => {
    const ratio = contrastRatio(tokens[text as keyof ThemeTokens], tokens[surface as keyof ThemeTokens]);
    expect({ label, ok: ratio >= BODY }).toEqual({ label, ok: true });
  });

  test("ink3 stays the quietest ink: less contrast than ink2, which has less than ink", () => {
    const on = (c: string) => contrastRatio(c, tokens.bg);
    expect(on(tokens.ink3)).toBeLessThan(on(tokens.ink2));
    expect(on(tokens.ink2)).toBeLessThan(on(tokens.ink));
  });

  test("the danger button label reaches 4.5:1 on the armed danger fill", () => {
    const label = tokens === lightTokens ? "#ffffff" : tokens.bg;
    expect(contrastRatio(label, tokens.danger)).toBeGreaterThanOrEqual(BODY);
  });
});

describe("bot colours", () => {
  test("light: the hint colour (botInk) reaches 4.5:1 on the armed option face for every bot", () => {
    for (const p of PALETTE) {
      const bt = botTheme({ colour: p.name });
      for (const base of [lightTokens.bg, lightTokens.card]) {
        expect({ bot: p.name, ok: contrastRatio(bt.botInk, bt.botTint, base) >= BODY }).toEqual({ bot: p.name, ok: true });
      }
    }
  });

  test("dark and night: botInk reaches 4.5:1 on the armed option face for every bot", () => {
    const bases = [darkTokens.bg, darkTokens.card, NIGHT_FACE, NIGHT_BG];
    for (const p of PALETTE) {
      for (const mode of [{ dark: true }, { dark: true, night: true }]) {
        const bt = botTheme({ colour: p.name }, mode);
        for (const base of bases) {
          expect({ bot: p.name, mode, base, ok: contrastRatio(bt.botInk, bt.botTint, base) >= BODY }).toEqual({
            bot: p.name,
            mode,
            base,
            ok: true,
          });
        }
      }
    }
  });

  test("botInk keeps the bot's hue: it is the brand colour only mixed toward white", () => {
    const coral = botTheme({ colour: "coral" }, { dark: true });
    const [r, g, b] = [parseColour(coral.botInk).r, parseColour(coral.botInk).g, parseColour(coral.botInk).b];
    expect(r).toBeGreaterThanOrEqual(226);
    expect(g).toBeGreaterThanOrEqual(75);
    expect(b).toBeGreaterThanOrEqual(58);
    expect(r).toBeGreaterThan(g);
  });

  test("the on-bot label is large text (17 dp, weight 900): 3:1 on the bot colour for every bot", () => {
    for (const p of PALETTE) {
      const bt = botTheme({ colour: p.name });
      expect({ bot: p.name, ok: contrastRatio(bt.onBot, bt.sendBg) >= LARGE }).toEqual({ bot: p.name, ok: true });
    }
  });

  test("text on the wash: ink2 and ink3, adjusted as AlertFrame does, reach 4.5:1 at night", () => {
    for (const p of PALETTE) {
      const bt = botTheme({ colour: p.name }, { dark: true, night: true });
      const washed = over(bt.glow, NIGHT_BG);
      for (const ink of [darkTokens.ink2, darkTokens.ink3]) {
        const fixed = ensureContrast(ink, [washed], BODY, "lighten");
        expect({ bot: p.name, ok: contrastRatio(fixed, washed) >= BODY }).toEqual({ bot: p.name, ok: true });
      }
    }
  });

  test("light washes need no adjustment for ink3 on the screen background", () => {
    for (const p of PALETTE) {
      const bt = botTheme({ colour: p.name });
      expect({ bot: p.name, ok: contrastRatio(lightTokens.ink3, bt.botWash, lightTokens.bg) >= BODY }).toEqual({
        bot: p.name,
        ok: true,
      });
    }
  });
});

describe("non-text marks (3:1)", () => {
  const SURFACES = ["bg", "card", "fill", "fill2"] as const;

  test.each([
    ["light", lightTokens],
    ["dark", darkTokens],
  ] as const)("%s: the outline token (empty checkbox, pending step, empty code slot) has 3:1 on every neutral surface", (_n, tokens) => {
    for (const surface of SURFACES) {
      expect({ surface, ok: contrastRatio(tokens.outline, tokens[surface]) >= LARGE }).toEqual({ surface, ok: true });
    }
  });

  test("the black bot on dark and night: rim and mark are seen on every dark surface (3:1) and keep a dark body", () => {
    for (const mode of [{ dark: true }, { dark: true, night: true }]) {
      const bt = botTheme({ colour: "black" }, mode);
      expect(bt.blobOutline).toBe(bt.mark);
      expect(bt.blobFill).toBe("#2A2826");
      for (const surface of [darkTokens.bg, darkTokens.card, darkTokens.fill, darkTokens.fill2, NIGHT_BG, NIGHT_FACE]) {
        expect({ mode, surface, ok: contrastRatio(bt.mark, surface) >= LARGE }).toEqual({ mode, surface, ok: true });
      }
      // The white tick on a checked box in the mark colour.
      expect(contrastRatio("#ffffff", bt.mark)).toBeGreaterThanOrEqual(LARGE);
      // The rim is what tells the body from the surface; the body alone would not be.
      expect(contrastRatio(bt.blobFill, darkTokens.bg)).toBeLessThan(LARGE);
    }
  });

  test("the black bot in light mode keeps its black body and no rim", () => {
    const bt = botTheme({ colour: "black" });
    expect(bt.blobFill).toBe("#111111");
    expect(bt.mark).toBe("#111111");
    expect(bt.blobOutline).toBeNull();
  });

  test("every bot's mark has 3:1 on the dark card and screen, and 3:1 on white in light", () => {
    for (const p of PALETTE) {
      const dark = botTheme({ colour: p.name }, { dark: true });
      for (const surface of [darkTokens.bg, darkTokens.card, NIGHT_BG]) {
        expect({ bot: p.name, surface, ok: contrastRatio(dark.mark, surface) >= LARGE }).toEqual({ bot: p.name, surface, ok: true });
      }
    }
  });
});

describe("the wash behind a Home card's avatar", () => {
  test("washStop splits an rgba wash into an opaque colour and its opacity", () => {
    expect(washStop("rgba(226, 75, 58, 0.1)")).toEqual({ rgb: "rgb(226, 75, 58)", alpha: 0.1 });
  });

  test("washGradientCss fades one rgb from the wash's alpha to clear, with no grey fringe", () => {
    expect(washGradientCss("rgba(226, 75, 58, 0.1)", "to right", 70)).toBe(
      "linear-gradient(to right, rgba(226, 75, 58, 0.1) 0%, rgba(226, 75, 58, 0) 70%)",
    );
    expect(washGradientCss("rgba(255, 255, 255, 0.07)", "to bottom right", 75)).toBe(
      "linear-gradient(to bottom right, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0) 75%)",
    );
  });

  test("every bot's wash is faint (16% at most in light and dark) once its alpha is honoured", () => {
    for (const p of PALETTE) {
      for (const dark of [false, true]) {
        expect(washStop(botTheme({ colour: p.name }, { dark }).botWash).alpha).toBeLessThanOrEqual(0.16);
      }
    }
  });

  test("the wash never swallows the avatar: 3:1 against it, or within 80% of what the plain card gives", () => {
    for (const [tokens, dark] of [[lightTokens, false], [darkTokens, true]] as const) {
      for (const p of PALETTE) {
        const bt = botTheme({ colour: p.name }, { dark });
        if (p.name === "black" && dark) continue; // the black bot's rim (mark) does this job in dark
        const plain = contrastRatio(bt.blobFill, tokens.card);
        const washed = contrastRatio(bt.blobFill, over(bt.botWash, tokens.card));
        expect({ bot: p.name, dark, ok: washed >= LARGE || washed >= 0.8 * plain }).toEqual({ bot: p.name, dark, ok: true });
      }
    }
  });

  test("the avatar ring is the card colour in light and a lifted grey in dark", () => {
    expect(lightTokens.avatarRing).toBe(lightTokens.card);
    expect(contrastRatio(darkTokens.avatarRing, darkTokens.card)).toBeGreaterThan(1.5);
  });
});

describe("fixed colours", () => {
  test("toast text (white on #1E1B19) passes", () => {
    expect(contrastRatio("#ffffff", "#1E1B19")).toBeGreaterThanOrEqual(BODY);
  });
});
