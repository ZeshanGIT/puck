/**
 * Theme context for the new UI. Components read the current mode's tokens with
 * `useTheme()` and a bot's colours with `useBotTheme(bot)`; they never import
 * `lightTokens` or `darkTokens` directly. Without a provider the theme follows
 * the system light or dark setting. `night` is set explicitly by the alert
 * screen (10 PM to 7 AM, urgent alerts over the lock screen).
 */
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { botTheme, type BotTheme, type ThemeBot } from "./botTheme";
import { ensureContrast, over } from "./contrast";
import { darkTokens, lightTokens, type ThemeTokens } from "./tokens";

export type ThemeMode = "light" | "dark" | "night";

export interface Theme {
  mode: ThemeMode;
  /** True for dark and night: use dark surfaces. */
  dark: boolean;
  night: boolean;
  tokens: ThemeTokens;
}

export function themeFor(mode: ThemeMode): Theme {
  return {
    mode,
    dark: mode !== "light",
    night: mode === "night",
    tokens: mode === "light" ? lightTokens : darkTokens,
  };
}

const ThemeContext = createContext<Theme | null>(null);

/** Forces a mode for everything inside. Omit `mode` to follow the system setting. */
export function ThemeProvider({ mode, children }: { mode?: ThemeMode; children: ReactNode }) {
  const system = useColorScheme();
  const resolved: ThemeMode = mode ?? (system === "dark" ? "dark" : "light");
  const theme = useMemo(() => themeFor(resolved), [resolved]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const provided = useContext(ThemeContext);
  const system = useColorScheme();
  return useMemo(() => provided ?? themeFor(system === "dark" ? "dark" : "light"), [provided, system]);
}

/** The bot's colours for the current mode (wash, tint, onBot, glow and so on). */
export function useBotTheme(bot: ThemeBot): BotTheme {
  const { dark, night } = useTheme();
  return useMemo(() => botTheme(bot, { dark, night }), [bot.colour, dark, night]);
}

/**
 * `ink2` and `ink3` for text that sits on a bot wash (`wash` over the opaque `surface` colour
 * behind it), moved toward white (dark, night) or black (light) only as far as needed to reach
 * 4.5:1 on the wash at its strongest. The plain tokens already pass on most washes; this covers
 * the rest (the night glow, and the dark mustard, green and tangerine washes).
 */
export function useOnWash(wash: string, surface: string): { ink2: string; ink3: string } {
  const { dark, tokens } = useTheme();
  return useMemo(() => {
    const washed = over(wash, surface);
    const direction = dark ? "lighten" : "darken";
    return {
      ink2: ensureContrast(tokens.ink2, [washed], 4.5, direction),
      ink3: ensureContrast(tokens.ink3, [washed], 4.5, direction),
    };
  }, [wash, surface, dark, tokens.ink2, tokens.ink3]);
}
