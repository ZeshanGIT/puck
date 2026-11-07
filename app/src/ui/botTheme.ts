/**
 * Bot colour theme, ported from the prototype's `PALETTE` and `botVars()` in
 * `vault/Projects/Puck/mockups/Puck prototype.html`. Plain TypeScript, no React.
 */
import { ensureContrast, over } from "./contrast";

export type PaletteName =
  | "black"
  | "coral"
  | "tangerine"
  | "mustard"
  | "moss"
  | "green"
  | "teal"
  | "sky"
  | "indigo"
  | "violet"
  | "plum"
  | "rose"
  | "brown"
  | "slate";

export interface PaletteEntry {
  name: PaletteName;
  /** Base colour (hex). */
  base: string;
  /** Deep colour (hex), used for bottom edges and shadows. */
  deep: string;
  /** Base colour as [r, g, b]. */
  rgb: readonly [number, number, number];
}

export const PALETTE: readonly PaletteEntry[] = [
  { name: "black", base: "#111111", deep: "#000000", rgb: [0, 0, 0] },
  { name: "coral", base: "#e24b3a", deep: "#9d261c", rgb: [226, 75, 58] },
  { name: "tangerine", base: "#f07b2b", deep: "#a4471a", rgb: [240, 123, 43] },
  { name: "mustard", base: "#e0a82e", deep: "#8a6414", rgb: [224, 168, 46] },
  { name: "moss", base: "#6f9a3e", deep: "#3f5e22", rgb: [111, 154, 62] },
  { name: "green", base: "#4fbf6e", deep: "#2a7a42", rgb: [79, 191, 110] },
  { name: "teal", base: "#2a9d8f", deep: "#17645b", rgb: [42, 157, 143] },
  { name: "sky", base: "#3d8fd6", deep: "#1f5a91", rgb: [61, 143, 214] },
  { name: "indigo", base: "#5b5fd6", deep: "#33368f", rgb: [91, 95, 214] },
  { name: "violet", base: "#9a5bd1", deep: "#5f3290", rgb: [154, 91, 209] },
  { name: "plum", base: "#b4467a", deep: "#74264d", rgb: [180, 70, 122] },
  { name: "rose", base: "#e86a8f", deep: "#a23a5a", rgb: [232, 106, 143] },
  { name: "brown", base: "#c47840", deep: "#5c2c14", rgb: [196, 120, 64] },
  { name: "slate", base: "#5f7482", deep: "#37454f", rgb: [95, 116, 130] },
];

/** Colours whose text is ink rather than white (prototype `botVars`). */
const INK_ON_BOT: ReadonlySet<PaletteName> = new Set<PaletteName>([
  "mustard",
  "tangerine",
  "green",
  "rose",
  "brown",
]);

export interface ThemeBot {
  colour: PaletteName;
}

export interface BotThemeMode {
  dark?: boolean;
  night?: boolean;
}

export interface BotTheme {
  /** `--bot`: the bot's base colour. */
  bot: string;
  /** `--botdeep`: bottom-edge colour. */
  botDeep: string;
  /** `--botwash`: background wash. */
  botWash: string;
  /** `--bottint`: selected or armed fill. */
  botTint: string;
  /** `--onbot`: text and icon colour on the bot colour. */
  onBot: string;
  /** `--botlight`: text colour on dark surfaces. */
  botLight: string;
  /**
   * Bot-coloured text (the "Tap again" hint): `botDeep` in light mode; in dark and night the
   * brand colour mixed toward white until it reaches 4.5:1 on the armed option face (the tint
   * over the dark card, screen and night surfaces). Not a brand colour: use `bot` or `botLight`
   * for glyphs, bars and ticks.
   */
  botInk: string;
  /** `--glow`: radial glow behind alert screens. */
  glow: string;
  /** `--glowring`: urgent ring colour. */
  glowRing: string;
  /** `--sendbg`: send button fill. */
  sendBg: string;
  /** The blob's body fill: the base colour, or a dark grey for the black bot in dark and night. */
  blobFill: string;
  /**
   * The bot's colour for non-text marks (status dot, progress, armed border, ticks): the base
   * colour, or a light grey for the black bot in dark and night, where black would vanish (3:1).
   */
  mark: string;
  /**
   * Stroke colour for the blob outline, set only for the black bot in dark or
   * night mode. The prototype draws it at stroke-width 2 in the 100-unit SVG viewBox.
   */
  blobOutline: string | null;
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** The black bot on dark surfaces: a dark body with a light rim, so it stays the black bot and is seen. */
const BLACK_DARK_BODY = "#2A2826";
const BLACK_DARK_RIM = "#8E8984";

/** Dark surfaces an armed option face can sit on: `bg`, `card`, the night face and the night screen. */
const DARK_FACE_BASES = ["#141312", "#1F1D1B", "#1C1A18", "#100F0E"] as const;

function findPalette(name: PaletteName): PaletteEntry {
  const entry = PALETTE.find((p) => p.name === name);
  if (!entry) {
    throw new Error(`Unknown bot colour: ${name}`);
  }
  return entry;
}

/**
 * Computes the bot colour variables for a bot in light, dark or night mode.
 * `night` takes precedence over `dark` for the wash, as in the prototype.
 */
export function botTheme(bot: ThemeBot, mode: BotThemeMode = {}): BotTheme {
  const dark = mode.dark === true;
  const night = mode.night === true;
  const darkish = dark || night;
  const entry = findPalette(bot.colour);
  const isBlack = bot.colour === "black";

  let wash: string;
  if (isBlack) {
    wash = darkish ? rgba([255, 255, 255], 0.07) : rgba([0, 0, 0], 0.045);
  } else if (night) {
    wash = rgba(entry.rgb, 0.3);
  } else {
    wash = rgba(entry.rgb, dark ? 0.16 : 0.1);
  }

  let tint: string;
  if (isBlack) {
    tint = darkish ? rgba([255, 255, 255], 0.07) : rgba([0, 0, 0], 0.05);
  } else {
    tint = rgba(entry.rgb, darkish ? 0.16 : 0.08);
  }

  const botDeep = isBlack && darkish ? "#000" : entry.deep;
  const bodyColour = isBlack && darkish ? BLACK_DARK_BODY : entry.base;

  const botLight = isBlack ? "#D8D4CF" : `rgb(${entry.rgb[0]}, ${entry.rgb[1]}, ${entry.rgb[2]})`;
  const botInk = darkish
    ? ensureContrast(botLight, DARK_FACE_BASES.map((base) => over(tint, base)), 4.5, "lighten")
    : botDeep;

  return {
    bot: entry.base,
    botDeep,
    botWash: wash,
    botTint: tint,
    onBot: INK_ON_BOT.has(bot.colour) ? "#1E1B19" : "#fff",
    botLight,
    botInk,
    glow: isBlack ? "rgba(255, 255, 255, 0.10)" : rgba(entry.rgb, 0.34),
    glowRing: isBlack ? "#6E6A66" : entry.base,
    sendBg: bodyColour,
    blobFill: bodyColour,
    mark: isBlack && darkish ? BLACK_DARK_RIM : entry.base,
    blobOutline: isBlack && darkish ? BLACK_DARK_RIM : null,
  };
}
