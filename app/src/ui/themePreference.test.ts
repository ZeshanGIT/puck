import { describe, expect, test } from "bun:test";
import {
  DEFAULT_THEME_PREFERENCE,
  explicitThemeMode,
  isThemePreference,
  themeIsDark,
  THEME_CHOICES,
} from "./themePreference";

describe("theme preference", () => {
  test("defaults to following the system", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
    expect(THEME_CHOICES.map((choice) => choice.id)).toEqual(["system", "light", "dark"]);
  });

  test("only the three known values are valid", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("night")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  test("system leaves the mode unforced; light and dark force it", () => {
    expect(explicitThemeMode("system")).toBeUndefined();
    expect(explicitThemeMode("light")).toBe("light");
    expect(explicitThemeMode("dark")).toBe("dark");
  });

  test("an explicit choice overrides the system setting in both directions", () => {
    expect(themeIsDark("light", true)).toBe(false);
    expect(themeIsDark("dark", false)).toBe(true);
    expect(themeIsDark("system", true)).toBe(true);
    expect(themeIsDark("system", false)).toBe(false);
  });
});
