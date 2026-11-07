import { canUseFullScreenIntent, hasDndAccess } from "puck-full-screen";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { readNotificationRowState } from "./onboarding/notificationSetup";

/** What this phone says about itself right now. Each is null until read (and Do Not Disturb stays null on an older build). */
export interface PhoneStates {
  notifications: boolean | null;
  fullScreen: boolean | null;
  dndAccess: boolean | null;
}

/**
 * The phone's real notification permission, full-screen access and Do Not Disturb access, read at
 * start and again each time the app comes back to the front (after the person changed one in
 * Android's settings). `refresh` reads them now.
 */
export function usePhoneStates(): { states: PhoneStates; refresh: () => Promise<PhoneStates> } {
  const [states, setStates] = useState<PhoneStates>({ notifications: null, fullScreen: null, dndAccess: null });

  const refresh = useCallback(async (): Promise<PhoneStates> => {
    let notifications: boolean | null = null;
    try {
      notifications = (await readNotificationRowState()).granted;
    } catch {
      notifications = null;
    }
    const next: PhoneStates = { notifications, fullScreen: canUseFullScreenIntent(), dndAccess: hasDndAccess() };
    setStates(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return { states, refresh };
}
