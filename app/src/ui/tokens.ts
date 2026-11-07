/**
 * Design tokens ported from the prototype's CSS (`:root` and `.dark, .night`)
 * in `vault/Projects/Puck/mockups/Puck prototype.html`. Values are copied as-is, except `ink2` (light)
 * and `ink3` (light and dark), which P9 moved to the closest warm greys that reach 4.5:1 on every
 * neutral surface (`contrast.test.ts` keeps them honest). `ink3` stays lighter than `ink2`.
 */

export interface ThemeTokens {
  bg: string;
  card: string;
  fill: string;
  fill2: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  edge: string;
  /** Borders of controls and markers (empty checkbox, pending step, empty code slot): 3:1 on the neutral surfaces. */
  outline: string;
  /** The thin ring around a bot avatar that sits on a wash of its own colour (a Home card). */
  avatarRing: string;
  warn: string;
  warnbg: string;
  danger: string;
  dangerbg: string;
  dangeredge: string;
  ok: string;
  okbg: string;
  primary: string;
  onprimary: string;
}

export const lightTokens: ThemeTokens = {
  bg: "#FFFFFF",
  card: "#FFFFFF",
  fill: "#F6F5F3",
  fill2: "#EFEDEA",
  ink: "#1E1B19",
  ink2: "#5A5550",
  ink3: "#6E6A65",
  line: "#ECE9E5",
  edge: "#DCD8D3",
  outline: "#8C8782",
  avatarRing: "#FFFFFF",
  warn: "#9A5B0E",
  warnbg: "#FFF5E6",
  danger: "#B3261E",
  dangerbg: "#FDF0EF",
  dangeredge: "#E8B4B0",
  ok: "#3F7A3A",
  okbg: "#EEF6EC",
  primary: "#1E1B19",
  onprimary: "#FFFFFF",
};

/** Used for `.dark` and `.night` in the prototype. */
export const darkTokens: ThemeTokens = {
  bg: "#141312",
  card: "#1F1D1B",
  fill: "#1A1917",
  fill2: "#262421",
  ink: "#F4F2F0",
  ink2: "#A8A29C",
  ink3: "#918C87",
  line: "#2E2B28",
  edge: "#0B0A09",
  outline: "#7A756F",
  avatarRing: "#4A4744",
  warn: "#E0A24A",
  warnbg: "#2A2115",
  danger: "#F2867E",
  dangerbg: "#2C1715",
  dangeredge: "#6A2D29",
  ok: "#8CC584",
  okbg: "#1A2618",
  primary: "#F4F2F0",
  onprimary: "#141312",
};

/** Corner radii in dp. */
export const radii = {
  row: 12,
  card: 20,
  option: 22,
  stackCard: 32,
} as const;

/** Nunito font family names as loaded by @expo-google-fonts/nunito. */
export const fontFamily = {
  medium: "Nunito_500Medium",
  semiBold: "Nunito_600SemiBold",
  bold: "Nunito_700Bold",
  extraBold: "Nunito_800ExtraBold",
  black: "Nunito_900Black",
} as const;

export interface TextStyleToken {
  fontSize: number;
  fontWeight: "500" | "600" | "700" | "800" | "900";
  fontFamily: string;
  letterSpacing?: number;
  textTransform?: "uppercase";
}

/**
 * Type scale in dp, taken from the prototype CSS. letterSpacing is in dp
 * (the CSS em value times the font size).
 */
export const typeScale = {
  /** `.q` alert question. */
  alertQuestion: {
    fontSize: 30,
    fontWeight: "800",
    fontFamily: fontFamily.extraBold,
  },
  /** `.acard .q` question inside a stack card. */
  stackQuestion: {
    fontSize: 25,
    fontWeight: "800",
    fontFamily: fontFamily.extraBold,
  },
  /** `.opt` option label. */
  optionLabel: {
    fontSize: 18,
    fontWeight: "800",
    fontFamily: fontFamily.extraBold,
  },
  /** `.desc` option description. */
  optionDescription: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: fontFamily.semiBold,
  },
  /** `.msg` body text. */
  body: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: fontFamily.semiBold,
  },
  /** `.sect` section header. */
  sectionHeader: {
    fontSize: 12.5,
    fontWeight: "900",
    fontFamily: fontFamily.black,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  /** Captions run from 13 to 13.5 across the prototype; weights vary per element. */
  captionMinSize: 13,
  captionMaxSize: 13.5,
} as const satisfies Record<string, TextStyleToken | number>;
