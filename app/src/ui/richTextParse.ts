/**
 * Pure rich-text parser for alert messages (no React Native imports, so it can be
 * unit-tested). `RichText.tsx` renders the spans.
 */
export interface RichSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  code: boolean;
}

/** Only this many characters are parsed; the rest is shown as plain text. */
export const RICH_TEXT_PARSE_LIMIT = 4000;

type Marker = "**" | "*" | "__";

interface Scan {
  spans: RichSpan[];
  /** Index just after the scanned text (or after the closing marker). */
  pos: number;
  /** True when the scan ended on the closing marker of its innermost opener. */
  closed: boolean;
}

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

function flagsOf(stack: readonly Marker[]): Omit<RichSpan, "text" | "code"> {
  return {
    bold: stack.includes("**"),
    italic: stack.includes("*"),
    underline: stack.includes("__"),
  };
}

/**
 * Recursive scanner with backtracking. An opener only counts if a matching
 * closer follows it; otherwise the marker characters stay plain text, so
 * nothing is dropped. Scans are memoised per (position, open markers), which
 * keeps pathological input linear-ish within the parse limit.
 */
class Scanner {
  private readonly memo = new Map<string, Scan>();

  constructor(private readonly s: string) {}

  run(start: number, stack: readonly Marker[]): Scan {
    const key = `${start}|${stack.join(",")}`;
    const cached = this.memo.get(key);
    if (cached) return cached;
    const result = this.scan(start, stack);
    this.memo.set(key, result);
    return result;
  }

  private scan(start: number, stack: readonly Marker[]): Scan {
    const s = this.s;
    const flags = flagsOf(stack);
    const top = stack[stack.length - 1];
    const spans: RichSpan[] = [];
    let buf = "";
    const flush = () => {
      if (buf) spans.push({ text: buf, ...flags, code: false });
      buf = "";
    };

    let pos = start;
    while (pos < s.length) {
      // A closer must follow non-space text and must not be the opener itself.
      if (top && pos > start && s.startsWith(top, pos) && !isSpace(s[pos - 1])) {
        flush();
        return { spans, pos: pos + top.length, closed: true };
      }

      const ch = s[pos]!;

      if (ch === "`") {
        const close = s.indexOf("`", pos + 1);
        if (close > pos + 1) {
          flush();
          spans.push({ text: s.slice(pos + 1, close), ...flags, code: true });
          pos = close + 1;
          continue;
        }
      }

      const candidates: Marker[] = s.startsWith("**", pos)
        ? ["**", "*"]
        : s.startsWith("__", pos)
          ? ["__"]
          : s.startsWith("*", pos)
            ? ["*"]
            : [];
      let opened: Scan | null = null;
      for (const marker of candidates) {
        if (stack.includes(marker) || isSpace(s[pos + marker.length])) continue;
        const sub = this.run(pos + marker.length, [...stack, marker]);
        if (sub.closed) {
          opened = sub;
          break;
        }
      }
      if (opened) {
        flush();
        spans.push(...opened.spans);
        pos = opened.pos;
        continue;
      }

      buf += ch;
      pos += 1;
    }
    flush();
    return { spans, pos, closed: false };
  }
}

function mergeSpans(spans: RichSpan[]): RichSpan[] {
  const out: RichSpan[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.bold === span.bold &&
      last.italic === span.italic &&
      last.underline === span.underline &&
      last.code === span.code
    ) {
      last.text += span.text;
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

/** Splits message text into styled spans. Pure; never throws. */
export function parseRichText(text: string): RichSpan[] {
  if (text.length === 0) return [];
  const head = text.slice(0, RICH_TEXT_PARSE_LIMIT);
  const tail = text.slice(RICH_TEXT_PARSE_LIMIT);
  const { spans } = new Scanner(head).run(0, []);
  if (tail) {
    spans.push({ text: tail, bold: false, italic: false, underline: false, code: false });
  }
  return mergeSpans(spans);
}
