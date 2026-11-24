/**
 * The Appearance setting's theme choice (System, Light or Dark). Pure, so the rules can be tested
 * without React Native. The stored value lives in `localSettings.ts`; `themeSettings.ts` applies it.
 */
import type { ThemePreference } from "@puck/appearance";
export { DEFAULT_THEME_PREFERENCE, THEME_CHOICES, isThemePreference, themeIsDark, type ThemePreference } from "@puck/appearance";

/** The mode to force, or undefined to follow the system setting. */
export function explicitThemeMode(preference: ThemePreference): Exclude<ThemePreference, "system"> | undefined {
  return preference === "system" ? undefined : preference;
}
