/**
 * WCAG 2.x contrast helpers. Plain TypeScript, no React. Used by the tests that keep the text
 * tokens honest (4.5:1 for body text, 3:1 for large text) and by `botTheme` to pick a bot text
 * colour that stays readable on dark surfaces.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

/** Parses `#rgb`, `#rrggbb`, `rgb(r, g, b)` and `rgba(r, g, b, a)`. Throws on anything else. */
export function parseColour(input: string): Rgba {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const full = hex.length === 3 ? hex.replace(/./gu, (c) => c + c) : hex;
    if (!/^[0-9a-f]{6}$/u.test(full)) throw new Error(`Unsupported colour: ${input}`);
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/u.exec(s);
  if (!m) throw new Error(`Unsupported colour: ${input}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

/** `fg` (any alpha) drawn over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * Contrast ratio of `fg` on `bg`. Translucent colours are composited: `fg` over `bg`, and `bg`
 * itself over `base` (the opaque colour behind it, default white) when `bg` has alpha.
 */
export function contrastRatio(fg: string, bg: string, base = "#ffffff"): number {
  const baseC = parseColour(base);
  const bgC = composite(parseColour(bg), baseC);
  const fgC = composite(parseColour(fg), bgC);
  const l1 = relativeLuminance(fgC);
  const l2 = relativeLuminance(bgC);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(c: Rgba): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

/** `fg` (any alpha) drawn over `bg`, as an opaque hex colour. */
export function over(fg: string, bg: string): string {
  return toHex(composite(parseColour(fg), parseColour(bg)));
}

/** Mixes `colour` toward white (`amount` 0 to 1) and returns a hex colour. */
export function lighten(colour: string, amount: number): string {
  const c = parseColour(colour);
  return toHex({ r: c.r + (255 - c.r) * amount, g: c.g + (255 - c.g) * amount, b: c.b + (255 - c.b) * amount, a: 1 });
}

/** Mixes `colour` toward black (`amount` 0 to 1) and returns a hex colour. */
export function darken(colour: string, amount: number): string {
  const c = parseColour(colour);
  return toHex({ r: c.r * (1 - amount), g: c.g * (1 - amount), b: c.b * (1 - amount), a: 1 });
}

/**
 * The closest colour to `fg` (same hue, mixed toward white when `direction` is "lighten", toward
 * black when "darken") that reaches `min`:1 on every one of `backgrounds` (opaque or translucent,
 * the latter composited over `base`). Returns `fg` itself, as hex, when it already passes.
 */
export function ensureContrast(
  fg: string,
  backgrounds: readonly string[],
  min: number,
  direction: "lighten" | "darken",
  base = "#ffffff",
): string {
  // A small margin keeps the result above `min` once the translucent backgrounds are rounded to hex.
  const passes = (c: string) => backgrounds.every((bg) => contrastRatio(c, bg, base) >= min + 0.05);
  const start = toHex(parseColour(fg));
  if (passes(start)) return start;
  for (let step = 1; step <= 100; step += 1) {
    const candidate = direction === "lighten" ? lighten(fg, step / 100) : darken(fg, step / 100);
    if (passes(candidate)) return candidate;
  }
  return direction === "lighten" ? "#FFFFFF" : "#000000";
}
