export interface ChoiceState {
  armedId: string | null;
  selectedIds: readonly string[];
}

export const emptyChoice: ChoiceState = { armedId: null, selectedIds: [] };

export interface ReplyPayload {
  optionIds: string[];
  customReply?: string;
}

/**
 * Single mode arms an option on the first tap and confirms it on the second.
 * Multi mode toggles the option.
 */
export function tapOption(
  state: ChoiceState,
  mode: "single" | "multi",
  optionId: string,
): { state: ChoiceState; confirmId: string | null } {
  if (mode === "single") {
    if (state.armedId === optionId) return { state: emptyChoice, confirmId: optionId };
    return { state: { armedId: optionId, selectedIds: [] }, confirmId: null };
  }
  const selected = new Set(state.selectedIds);
  if (selected.has(optionId)) selected.delete(optionId);
  else selected.add(optionId);
  return { state: { armedId: null, selectedIds: [...selected] }, confirmId: null };
}

/** Select every option, or clear them when they are already all selected. */
export function toggleAll(state: ChoiceState, optionIds: readonly string[]): ChoiceState {
  const all = optionIds.length > 0 && optionIds.every((id) => state.selectedIds.includes(id));
  return { armedId: null, selectedIds: all ? [] : [...optionIds] };
}

/** The body for `answers.record`. A second tap passes `confirmId`. */
export function replyPayload(input: {
  mode: "single" | "multi";
  state: ChoiceState;
  confirmId: string | null;
  customReply: string;
}): ReplyPayload {
  const text = input.customReply.trim();
  const optionIds = input.confirmId
    ? [input.confirmId]
    : input.mode === "single"
      ? input.state.armedId
        ? [input.state.armedId]
        : []
      : [...input.state.selectedIds];
  if (optionIds.length === 0 && !text) {
    throw new Error("choose an option or send a custom reply");
  }
  return text ? { optionIds, customReply: text } : { optionIds };
}
