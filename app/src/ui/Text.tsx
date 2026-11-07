/**
 * The app's `Text`: React Native's `Text` with `maxFontSizeMultiplier` defaulting to 1.3, so no
 * text grows past 130% when the phone's font size is turned up (spec: Look and feel, Accessibility).
 *
 * Why a component and not a root default: React Native 0.88's `Text` is a function component and
 * React 19 ignores `defaultProps` on function components, so a root-level default would silently
 * do nothing. Import `Text` from here, never from `react-native`. A `maxFontSizeMultiplier` set on
 * the element still wins (a smaller cap, or `0` for no cap).
 */
import { Text as NativeText, type TextProps, useWindowDimensions } from "react-native";

/** The font scale cap: the design says text follows the phone's setting up to 130%. */
export const MAX_FONT_SCALE = 1.3;

export function Text({ maxFontSizeMultiplier = MAX_FONT_SCALE, ...rest }: TextProps) {
  return <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...rest} />;
}

/**
 * Line limit for text that is clipped to `base` lines at the normal size. Once the phone's font
 * size is above normal the limit opens up (one more line, or no limit for a single line) so a
 * scaled-up row wraps and grows instead of ending in an ellipsis. Use the result as `numberOfLines`.
 */
export function useLines(base: number): number | undefined {
  const { fontScale } = useWindowDimensions();
  if (fontScale <= 1.05) return base;
  return base <= 1 ? undefined : base + 1;
}
