/**
 * The answers the bottom card offers when it is swiped up. A swipe picks one thing, so the card
 * offers the alert's options when there are at most four of them and one may be picked; otherwise
 * it offers a way into the alert. Pure, so it can be unit-tested.
 */

/** One answer on the card. `open` opens the alert instead of answering. */
export interface CardChoice {
  id: string;
  label: string;
  /** A risky answer (`tone: "destructive"`): the card turns red and it needs a short hold. */
  risky: boolean;
  open: boolean;
}

/** What the card needs to know about the alert. */
export interface CardChoiceInput {
  selectionMode: string;
  options: readonly { id: string; label: string; tone?: string | null }[];
}

/** The most answers the card shows at once; with more, it shows one fewer and "More…". */
export const MAX_CARD_CHOICES = 4;

const OPEN_ID = "__open";

function openChoice(label: string): CardChoice {
  return { id: OPEN_ID, label, risky: false, open: true };
}

export function cardChoices(alert: CardChoiceInput): CardChoice[] {
  if (alert.selectionMode === "multi") return [openChoice("Pick several…")];
  if (alert.options.length === 0) return [openChoice("Open")];
  const answers = alert.options.map((option) => ({
    id: option.id,
    label: option.label,
    risky: option.tone === "destructive",
    open: false,
  }));
  if (answers.length <= MAX_CARD_CHOICES) return answers;
  return [...answers.slice(0, MAX_CARD_CHOICES - 1), openChoice("More…")];
}
