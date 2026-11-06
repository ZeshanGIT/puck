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
