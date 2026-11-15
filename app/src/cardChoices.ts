/**
 * The answers the bottom card offers when it is swiped up. A swipe picks one thing, so the card
 * offers the alert's options when there are at most four of them and one may be picked; otherwise
 * it offers a way into the alert. Pure, so it can be unit-tested.
 */

/** One answer on the card. `open` opens the alert instead of answering. */
export interface CardChoice {
  id: string;
  label: string;
  /** The option's description as plain text (its markdown marks removed); "" when it has none. */
  desc: string;
  /** The bot recommends this one: the card marks it "Suggested". */
  rec: boolean;
  /** A risky answer (`tone: "destructive"`): the card turns red and it needs a short hold. */
  risky: boolean;
  open: boolean;
}

/** What the card needs to know about the alert. */
export interface CardChoiceInput {
  selectionMode: string;
  options: readonly { id: string; label: string; tone?: string | null; desc?: string | null; rec?: boolean | null }[];
}

/** The most answers the card shows at once; with more, it shows one fewer and "More…". */
export const MAX_CARD_CHOICES = 4;

const OPEN_ID = "__open";

function openChoice(label: string): CardChoice {
  return { id: OPEN_ID, label, desc: "", rec: false, risky: false, open: true };
}

/**
 * A description written in the alert's light markdown (`**bold**`, `*italic*`, `__underline__`,
 * `` `code` ``, `[text](url)`) as plain text for the card, on one line.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function cardChoices(alert: CardChoiceInput): CardChoice[] {
  if (alert.selectionMode === "multi") return [openChoice("Pick several…")];
  if (alert.options.length === 0) return [openChoice("Open")];
  const answers = alert.options.map((option) => ({
    id: option.id,
    label: option.label,
    desc: option.desc ? plainText(option.desc) : "",
    rec: option.rec === true,
    risky: option.tone === "destructive",
    open: false,
  }));
  if (answers.length <= MAX_CARD_CHOICES) return answers;
  return [...answers.slice(0, MAX_CARD_CHOICES - 1), openChoice("More…")];
}
