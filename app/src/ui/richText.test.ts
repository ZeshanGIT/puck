import { describe, expect, test } from "bun:test";
import { parseRichText, RICH_TEXT_PARSE_LIMIT, type RichSpan } from "./richTextParse";

/** Compact view of a span: text plus the flags that are set, e.g. "bold:go". */
function flat(spans: RichSpan[]): string[] {
  return spans.map((s) => {
    const flags = [s.bold && "b", s.italic && "i", s.underline && "u", s.code && "c"].filter(Boolean);
    return flags.length ? `${flags.join("")}:${s.text}` : s.text;
  });
}

describe("parseRichText", () => {
  test("plain text stays one plain span and keeps newlines", () => {
    expect(flat(parseRichText("All checks passed.\nTwo fixes."))).toEqual(["All checks passed.\nTwo fixes."]);
  });

  test("empty string gives no spans", () => {
    expect(parseRichText("")).toEqual([]);
  });

  test("bold", () => {
    expect(flat(parseRichText("Error rate is **0.4%** now"))).toEqual([
      "Error rate is ",
      "b:0.4%",
      " now",
    ]);
  });

  test("italic", () => {
    expect(flat(parseRichText("a *soft* word"))).toEqual(["a ", "i:soft", " word"]);
  });

  test("underline", () => {
    expect(flat(parseRichText("__read__ this"))).toEqual(["u:read", " this"]);
  });

  test("code is a literal span", () => {
    expect(flat(parseRichText("run `puck status end` now"))).toEqual([
      "run ",
      "c:puck status end",
      " now",
    ]);
  });

  test("nesting: bold containing italic", () => {
    const spans = parseRichText("**bold *and italic***");
    expect(spans).toEqual([
      { text: "bold ", bold: true, italic: false, underline: false, code: false },
      { text: "and italic", bold: true, italic: true, underline: false, code: false },
    ]);
  });

  test("nesting: underline inside bold", () => {
    expect(flat(parseRichText("**x __y__**"))).toEqual(["b:x ", "bu:y"]);
  });

  test("a stray * stays plain text and drops nothing", () => {
    expect(flat(parseRichText("5 * 3 is 15"))).toEqual(["5 * 3 is 15"]);
    expect(flat(parseRichText("ends with *"))).toEqual(["ends with *"]);
  });

  test("an unmatched ** stays plain text", () => {
    expect(flat(parseRichText("**open only"))).toEqual(["**open only"]);
    expect(flat(parseRichText("**"))).toEqual(["**"]);
  });

  test("an unmatched _ or backtick stays plain text", () => {
    expect(flat(parseRichText("snake_case_name and `tick"))).toEqual(["snake_case_name and `tick"]);
  });

  test("code next to bold", () => {
    expect(flat(parseRichText("**go** `now`"))).toEqual(["b:go", " ", "c:now"]);
  });

  test("markup inside code stays literal", () => {
    expect(flat(parseRichText("`**not bold** and *not italic*`"))).toEqual([
      "c:**not bold** and *not italic*",
    ]);
  });

  test("markup inside code next to bold is still parsed outside", () => {
    expect(flat(parseRichText("**a** `*b*` c"))).toEqual(["b:a", " ", "c:*b*", " c"]);
  });

  test("no links, images or HTML", () => {
    expect(flat(parseRichText("[site](https://example.com) <b>x</b> ![i](y.png)"))).toEqual([
      "[site](https://example.com) <b>x</b> ![i](y.png)",
    ]);
  });

  test("long input: only the first 4000 characters are parsed", () => {
    const head = "**" + "a".repeat(RICH_TEXT_PARSE_LIMIT - 4) + "**";
    const tail = "**tail**";
    const spans = parseRichText(head + tail);
    expect(spans[0]?.bold).toBe(true);
    expect(spans[0]?.text.length).toBe(RICH_TEXT_PARSE_LIMIT - 4);
    const last = spans[spans.length - 1]!;
    expect(last).toEqual({ text: tail, bold: false, italic: false, underline: false, code: false });
  });

  test("pathological input finishes and keeps every character", () => {
    const input = "*a ".repeat(1500) + "`x".repeat(500);
    const spans = parseRichText(input);
    const joined = spans.map((s) => s.text).join("");
    expect(joined.replace(/[*_`]/g, "").length).toBe(input.replace(/[*_`]/g, "").length);
  });
});
