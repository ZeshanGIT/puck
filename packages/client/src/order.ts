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
