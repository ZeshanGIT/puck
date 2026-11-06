/**
 * The pure rules of the A8 stack, with no React Native imports so `bun test` can load them:
 * the order of the cards, how the position moves, and which cards peek out behind the front one.
 * Prototype: `openQueue`, `cycle()`, `advance()` and the `behind` ring in `alertScreen`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` A8.
 *
 * Positions ("slots") run over the alerts in stack order and then one more slot, the summary.
 */

export interface Orderable {
  priority: "normal" | "urgent";
  /** Epoch ms the alert came in. */
  createdAt: number;
}

/**
 * Urgent alerts first, then the oldest first (A8: "urgent first, then oldest first"). Alerts that
 * tie keep the order they came in. Returns a new array and leaves the input alone.
 */
export function orderStack<T extends Orderable>(alerts: readonly T[]): T[] {
  return alerts
    .map((alert, position) => ({ alert, position }))
    .sort((a, b) => {
      const urgent = Number(b.alert.priority === "urgent") - Number(a.alert.priority === "urgent");
      if (urgent !== 0) return urgent;
      if (a.alert.createdAt !== b.alert.createdAt) return a.alert.createdAt - b.alert.createdAt;
      return a.position - b.position;
    })
    .map((entry) => entry.alert);
}

/** `cycle(dir)`: one slot forward (1, a drag to the left) or back (-1), wrapping round the ring. */
export function stepSlot(current: number, direction: 1 | -1, slots: number): number {
  if (slots <= 0) return 0;
  return (((current + direction) % slots) + slots) % slots;
}

/**
 * `advance()`: the next card that is still unanswered, looking forward round the ring from
 * `from` (`from` itself is the last one looked at, as in the prototype). When every card is
 * answered it is the summary slot, which is `answered.length`.
 */
export function nextUnansweredSlot(answered: readonly boolean[], from: number): number {
  const n = answered.length;
  for (let k = 1; k <= n; k++) {
    const slot = (from + k) % n;
    if (!answered[slot]) return slot;
  }
  return n;
}

/**
 * The cards that peek out behind the front one, nearest first (at most two). The prototype looks
 * at the next two slots round a ring that includes the summary slot and drops the summary (it has
 * no bot colour), so just before the summary only one card peeks, and the one after the summary
 * takes the first peek.
 */
export function peekSlots(current: number, itemCount: number, hasSummary: boolean): number[] {
  const ring = itemCount + (hasSummary ? 1 : 0);
  if (ring <= 0) return [];
  const behind: number[] = [];
  for (const k of [1, 2]) {
    const slot = (current + k) % ring;
    if (slot < itemCount && slot !== current) behind.push(slot);
  }
  return behind;
}

/** `${done} of ${n} answered · swipe to switch`, the line under the top row. */
export function stackCaption(done: number, total: number): string {
  return `${done} of ${total} answered · swipe to switch`;
}
