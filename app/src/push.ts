import { anyApi } from "convex/server";
import { useConvex } from "convex/react";
import { AppState } from "react-native";
import { useEffect, useRef, useState } from "react";
import { readClientId } from "./clientStore";
import { subscribeOverlayOpen, peekOverlayOpen, type OverlayOpen } from "puck-full-screen";
import { cardSnoozeFromNative, requestSnoozeOnOpen, shouldHandleOpen } from "./cardSnooze";
import { questionIdFromNotificationData } from "./pushOpen";
import { acceptInitialOpen } from "./alertLaunchRouting";
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

    async function reconcile() {
      try {
        const Notifications = await loadNotificationsModule();
        if (!Notifications || cancelled) return;
        const ok = await registerPushTokenWithConvex(Notifications, registerToken);
        if (!cancelled) setGranted(ok);
      } catch (error: unknown) {
        console.error(readableError(error));
      }
    }

    void loadNotificationsModule().then((Notifications) => {
      if (!Notifications || cancelled) return;
      const subscription = Notifications.addPushTokenListener((next) => {
        if (typeof next.data !== "string") return;
        registerToken(next.data).catch((error: unknown) => console.error(readableError(error)));
      });
      remove = () => subscription.remove();
      void reconcile();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void reconcile();
    });
    return () => {
      cancelled = true;
      remove();
      app.remove();
    };
  }, [client, enabled]);

  return granted;
}

/** Question opened from a notification tap, including a cold start, or from the compact card. */
export function useOpenedQuestionId(): string | null {
  const [opened, setOpened] = useState<string | null>(() => peekOverlayOpen()?.questionId ?? null);
  // A lookup started before a live open must never replace that newer action.
  const openRevision = useRef(0);

  useEffect(() => {
    const open = (next: OverlayOpen) => {
      if (!shouldHandleOpen(next.nonce)) return;
      openRevision.current += 1;
      if (next.snooze) requestSnoozeOnOpen(next.questionId, cardSnoozeFromNative(next.snoozeMinutes));
      setOpened(next.questionId);
    };
    const apply = () => {
      const next = peekOverlayOpen();
      if (next) open(next);
    };
    const unsubscribe = subscribeOverlayOpen(open);
    apply();
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
          const id = questionIdFromNotificationData(response.notification.request.content.data);
          if (id) { openRevision.current += 1; setOpened(id); }
        });
        remove = () => subscription.remove();
        const revision = openRevision.current;
        return Notifications.getLastNotificationResponseAsync().then((response) => ({ response, revision }));
      })
      .then((result) => {
        if (!result || !result.response || cancelled || !acceptInitialOpen(result.revision, openRevision.current)) return;
        const id = questionIdFromNotificationData(result.response.notification.request.content.data);
        if (id) { openRevision.current += 1; setOpened(id); }
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
        remove = mod.default.onForegroundEvent(({ type, detail }) => {
          if (type !== mod.EventType.PRESS) return;
          const openedId = questionIdFromNotificationData(detail.notification?.data ?? null);
          if (openedId) { openRevision.current += 1; setOpened(openedId); }
        });
        const revision = openRevision.current;
        const initial = await mod.default.getInitialNotification();
        if (cancelled || !acceptInitialOpen(revision, openRevision.current)) return;
        const initialId = questionIdFromNotificationData(initial?.notification.data ?? null);
        if (initialId) { openRevision.current += 1; setOpened(initialId); }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      remove();
    };
  }, []);

  return opened;
}
