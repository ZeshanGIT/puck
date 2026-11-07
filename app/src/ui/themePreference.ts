/**
 * The Preferences screen's theme choice (System, Light or Dark). Pure, so the rules can be tested
 * without React Native. The stored value lives in `localSettings.ts`; `themeSettings.ts` applies it.
 */
import type { ThemeMode } from "./theme";

export type ThemePreference = "system" | "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const THEME_CHOICES: readonly { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** The mode to force, or undefined to follow the system setting. */
export function explicitThemeMode(preference: ThemePreference): Exclude<ThemeMode, "night"> | undefined {
  return preference === "system" ? undefined : preference;
}

/** True when the app should draw its dark palette: an explicit choice wins over the system. */
export function themeIsDark(preference: ThemePreference, systemIsDark: boolean): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return systemIsDark;
}
