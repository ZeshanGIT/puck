/**
 * Alerts whose compact card was snoozed. The app opens each one on its snooze choices, once: a
 * request made while the alert is already on screen is also picked up through the listeners.
 */
const pending = new Set<string>();
const listeners = new Set<() => void>();

export function requestSnoozeOnOpen(questionId: string): void {
  pending.add(questionId);
  for (const listener of listeners) listener();
}

export function takeSnoozeOnOpen(questionId: string): boolean {
  return pending.delete(questionId);
}

export function subscribeSnoozeRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
