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

/** True when the app should draw its dark palette: an explicit choice wins over the system. */
export function themeIsDark(preference: ThemePreference, systemIsDark: boolean): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return systemIsDark;
}
