/**
 * Basic rich text for alert `message` and `details`, and option descriptions.
 * Markup (see Protocol changes §1): `**bold**`, `*italic*`, `__underline__` and
 * `` `code` ``. Nesting works (`**bold *and italic***`). Anything else is plain
 * text: no links, images or HTML. Mirrors the prototype's `md()` helper and the
 * `.msg b`, `.desc code` CSS, with two deliberate differences: markup nests, and
 * code is literal (the prototype parses markup inside code).
 *
 * The parser is pure so it can be tested without React Native.
 */
import { useMemo } from "react";
import { Text, type TextStyle } from "react-native";
import { useTheme } from "./theme";
import { fontFamily } from "./tokens";

export { parseRichText, RICH_TEXT_PARSE_LIMIT, type RichSpan } from "./richTextParse";
import { parseRichText, type RichSpan } from "./richTextParse";

export interface RichTextProps {
  text: string;
  /** Base text style, normally a `typeScale` entry. */
  style?: TextStyle;
  numberOfLines?: number;
}

/**
 * Renders parsed spans as nested `<Text>`. Limitation: React Native ignores
 * padding and border radius on inline text, so the code chip gets a flat
 * `fill2` background with thin spaces standing in for the prototype's 5 px
 * side padding, and square corners instead of the 6 px radius.
 */
export function RichText({ text, style, numberOfLines }: RichTextProps) {
  const { tokens } = useTheme();
  const spans = useMemo(() => parseRichText(text), [text]);
  const baseSize = style?.fontSize ?? 16;

  return (
    <Text style={[{ color: tokens.ink2 }, style]} numberOfLines={numberOfLines}>
      {spans.map((span, index) => {
        if (span.code) {
          return (
            <Text
              key={index}
              style={{
                fontFamily: "monospace",
                fontWeight: "700",
                fontSize: baseSize * 0.88,
                color: tokens.ink,
                backgroundColor: tokens.fill2,
              }}
            >
              {` ${span.text} `}
            </Text>
          );
        }
        if (!span.bold && !span.italic && !span.underline) {
          return <Text key={index}>{span.text}</Text>;
        }
        return (
          <Text
            key={index}
            style={{
              ...(span.bold ? { fontFamily: fontFamily.extraBold, fontWeight: "800" as const, color: tokens.ink } : {}),
              ...(span.italic ? { fontStyle: "italic" as const } : {}),
              ...(span.underline ? { textDecorationLine: "underline" as const } : {}),
            }}
          >
            {span.text}
          </Text>
        );
      })}
    </Text>
  );
}
