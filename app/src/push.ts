import { anyApi } from "convex/server";
import { useConvex } from "convex/react";
import { AppState } from "react-native";
import { useEffect, useState } from "react";
import { readClientId } from "./clientStore";
import { subscribeOverlayOpen, takeOverlayOpen } from "puck-full-screen";
import { questionIdFromNotificationData } from "./pushOpen";
import { readableError } from "./session";
import { loadNotificationsModule, registerPushTokenWithConvex } from "./onboarding/notificationSetup";

/** Registers this phone for heads-up alerts once the device JWT is in place. */
export function usePushRegistration(enabled: boolean): boolean | null {
  const client = useConvex();
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let remove = () => {};

    // Signed-in installs register the token on their client row; old installs use the device row.
    async function registerToken(token: string) {
      const clientId = await readClientId();
      if (clientId) await client.mutation(anyApi.clients.setPushToken, { clientId, token });
      else await client.mutation(anyApi.device.registerPushToken, { token });
    }

    async function run() {
      const Notifications = await loadNotificationsModule();
      if (!Notifications || cancelled) return;
      const ok = await registerPushTokenWithConvex(Notifications, registerToken);
      if (cancelled) return;
      setGranted(ok);
      const subscription = Notifications.addPushTokenListener((next) => {
        if (typeof next.data !== "string") return;
        registerToken(next.data).catch((error: unknown) => {
          console.error(readableError(error));
        });
      });
      remove = () => subscription.remove();
    }

    run().catch((error: unknown) => {
      console.error(readableError(error));
    });
    return () => {
      cancelled = true;
      remove();
    };
  }, [client, enabled]);

  return granted;
}

/** Question opened from a notification tap, including a cold start, or from the compact card. */
export function useOpenedQuestionId(): string | null {
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    const apply = () => {
      const id = takeOverlayOpen();
      if (id) setOpened(id);
    };
    apply();
    const unsubscribe = subscribeOverlayOpen(setOpened);
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") apply();
    });
    return () => {
      unsubscribe();
      app.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let remove = () => {};
    loadNotificationsModule()
      .then((Notifications) => {
        if (!Notifications || cancelled) return null;
        const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          setOpened(questionIdFromNotificationData(response.notification.request.content.data));
        });
        remove = () => subscription.remove();
        return Notifications.getLastNotificationResponseAsync();
      })
      .then((response) => {
        if (!response || cancelled) return;
        setOpened(questionIdFromNotificationData(response.notification.request.content.data));
      })
      .catch((error: unknown) => {
        console.error(readableError(error));
      });
    return () => {
      cancelled = true;
      remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let remove = () => {};
    import("@notifee/react-native")
      .then(async (mod) => {
        if (cancelled) return;
        const initial = await mod.default.getInitialNotification();
        const initialId = questionIdFromNotificationData(initial?.notification.data ?? null);
        if (initialId) setOpened(initialId);
        remove = mod.default.onForegroundEvent(({ type, detail }) => {
          if (type !== mod.EventType.PRESS) return;
          const openedId = questionIdFromNotificationData(detail.notification?.data ?? null);
          if (openedId) setOpened(openedId);
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      remove();
    };
  }, []);

  return opened;
}
