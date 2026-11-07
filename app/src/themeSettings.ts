/**
 * Applies the Preferences theme (System, Light or Dark) to the whole app. It reads the stored choice
 * and follows every save (`subscribeLocalSettings`), so a change shows at once and survives a
 * restart. React Native's appearance is set to match, so the system bars agree with the screens.
 */
import { useEffect, useState } from "react";
import { Appearance } from "react-native";
import { loadLocalSettings, subscribeLocalSettings } from "./localSettings";
import { DEFAULT_THEME_PREFERENCE, explicitThemeMode, type ThemePreference } from "./ui/themePreference";

export function useThemePreference(): ThemePreference {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);

  useEffect(() => {
    let cancelled = false;
    void loadLocalSettings().then((settings) => {
      if (!cancelled) setPreference(settings.theme);
    });
    const unsubscribe = subscribeLocalSettings((settings) => setPreference(settings.theme));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(explicitThemeMode(preference) ?? "unspecified");
  }, [preference]);

  return preference;
}
