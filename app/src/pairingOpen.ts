/**
 * The pairing request a tap on its notification (N7) asked to open. The Notifee handlers in
 * `urgentDisplay.ts` and the cold-start check in `useOpenedPairingBotId` put the bot id here; the
 * inbox opens B4 for it and clears it. A tiny store, so a tap that arrives while the inbox is not
 * mounted (or while an alert is on screen) waits instead of being lost.
 */
import { useEffect, useSyncExternalStore } from "react";
import { pairingBotIdFromNotificationData } from "./pairingPayload";

let opened: string | null = null;
let initialChecked = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** A pairing notification was tapped. */
export function openPairing(botId: string): void {
  if (opened === botId) return;
  opened = botId;
  emit();
}

/** The inbox took the request; forget it so a later mount does not open it again. */
export function clearOpenedPairing(): void {
  if (opened === null) return;
  opened = null;
  emit();
}

export function openedPairingBotId(): string | null {
  return opened;
}

/** Test helper: back to a fresh start. */
export function resetPairingOpen(): void {
  opened = null;
  initialChecked = false;
  listeners.clear();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Handles a Notifee notification's `data` (a press): opens its pairing request, ignores any other. */
export function openPairingFromNotificationData(data: unknown): boolean {
  const botId = pairingBotIdFromNotificationData(data);
  if (botId === null) return false;
  openPairing(botId);
  return true;
}

/**
 * The bot id whose pairing notification he tapped, from a cold start (the notification that
 * launched the app) or while running (`urgentTask.ts` registers the Notifee press handler that
 * feeds the same store). Null when there is none waiting.
 */
export function useOpenedPairingBotId(): string | null {
  const value = useSyncExternalStore(subscribe, openedPairingBotId, openedPairingBotId);
  useEffect(() => {
    // Once per run of the app: the launching notification would otherwise come back on every mount.
    if (initialChecked) return;
    initialChecked = true;
    import("@notifee/react-native")
      .then(async (mod) => {
        const initial = await mod.default.getInitialNotification();
        openPairingFromNotificationData(initial?.notification.data ?? null);
      })
      .catch(() => {});
  }, []);
  return value;
}
