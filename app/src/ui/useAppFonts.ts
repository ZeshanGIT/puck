import {
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  useFonts,
} from "@expo-google-fonts/nunito";

/**
 * Loads Nunito weights 500 to 900 at startup.
 * Returns true once the app can render: either the fonts are loaded, or loading failed
 * (the app then falls back to the system font instead of staying blank).
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });

  if (error) {
    console.warn("Nunito failed to load; using the system font.", error);
  }

  return loaded || error !== null;
}
