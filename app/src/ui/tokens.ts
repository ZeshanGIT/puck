export { darkTokens, lightTokens, radii, type ThemeTokens } from "@puck/appearance";

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
