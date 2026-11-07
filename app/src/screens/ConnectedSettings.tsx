/**
 * The Settings screens on Convex and on the phone's real states: `clients.list`, `clients.rename`,
 * `clients.remove`, `alerts.sendTest` and `alerts.get` (the test page's result), the local
 * settings (`localSettings.ts`), and the notification, full-screen and Do Not Disturb states
 * (`usePhoneStates`). The screens themselves are in `SettingsHost`.
 */
import { anyApi } from "convex/server";
import { useConvex, useQuery } from "convex/react";
import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking } from "react-native";
import { openSoundSettings } from "../botSoundSettings";
import { syncClientPushToken } from "../clientAuth";
import { convexUrl } from "../deployment";
import { dndBypassActive } from "../homeModel";
import { DEFAULT_LOCAL_SETTINGS, loadLocalSettings, saveLocalSettings, type LocalSettings } from "../localSettings";
import { openDndAccessSettings } from "../onboarding/dndAccess";
import { openFullScreenSettings } from "../onboarding/fullScreenSetup";
import { ensureNotificationPermission, readNotificationRowState } from "../onboarding/notificationSetup";
import { readableError } from "../session";
import {
  backendName,
  clientHealth,
  testPageStatus,
  versionText,
  type ClientItem,
  type HealthSnapshot,
  type TestAlertView,
  type TestPageStatus,
} from "../settingsModel";
import { usePhoneStates } from "../usePhoneStates";
import { useOnline } from "./A10Offline";
import { SettingsHost, type SettingsNav, type SettingsSource } from "./SettingsHost";

export function ConnectedSettingsHost({
  clientId,
  email,
  nav,
  onNav,
  onSignOut,
  onClose,
}: {
  clientId: string | null | undefined;
  email: string | null;
  nav: SettingsNav;
  onNav: (nav: SettingsNav) => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const client = useConvex();
  const id = clientId ?? null;
  const clients = useQuery(anyApi.clients.list, id ? {} : "skip") as ClientItem[] | undefined;
  const online = useOnline();
  const phone = usePhoneStates();
  const [settings, setSettings] = useState<LocalSettings>(DEFAULT_LOCAL_SETTINGS);
  useEffect(() => {
    let cancelled = false;
    void loadLocalSettings().then((loaded) => {
      if (!cancelled) setSettings(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tell the backend what this phone can do when that changes, so it sends urgent alerts the right way.
  const synced = useRef<string>("");
  useEffect(() => {
    if (!id || phone.states.fullScreen === null) return;
    const key = `${phone.states.fullScreen}|${phone.states.dndAccess}`;
    if (synced.current === key) return;
    synced.current = key;
    client
      .mutation(anyApi.clients.setFlags, {
        clientId: id,
        fullScreenAllowed: phone.states.fullScreen,
        ...(phone.states.dndAccess === null ? {} : { dndAccess: phone.states.dndAccess }),
      })
      .catch((error: unknown) => console.error(readableError(error)));
  }, [client, id, phone.states.fullScreen, phone.states.dndAccess]);

  const health = useMemo<HealthSnapshot>(
    () => ({
      ...phone.states,
      dndNeeded: dndBypassActive(settings),
      ...clientHealth(clients, id),
      online,
    }),
    [phone.states, settings, clients, id, online],
  );

  const about = useMemo(() => {
    const version = versionText({
      version: Constants.nativeAppVersion ?? Constants.expoConfig?.version,
      build: Constants.nativeBuildVersion,
      dev: __DEV__,
    });
    return {
      ...version,
      backend: backendName(convexUrl),
      devInfo: __DEV__
        ? [
            { label: "Convex URL", value: convexUrl },
            { label: "Client id", value: id ?? "none" },
          ]
        : undefined,
    };
  }, [id]);

  const { refresh } = phone;
  const source = useMemo<SettingsSource>(() => {
    const needClient = (): string => {
      if (!id) throw new Error("Sign in again to change this");
      return id;
    };
    return {
      email,
      clientId: id,
      clients,
      settings,
      health,
      about,
      setSettings: async (change) => {
        setSettings(await saveLocalSettings(change));
      },
      rename: async (name) => {
        await client.mutation(anyApi.clients.rename, { clientId: needClient(), name });
      },
      removeClient: async (clientToRemove) => {
        await client.mutation(anyApi.clients.remove, { clientId: clientToRemove });
      },
      openSound: openSoundSettings,
      fix: async (fix) => {
        if (fix === "notifications") {
          if ((await readNotificationRowState()).canAskAgain) await ensureNotificationPermission();
          else await Linking.openSettings();
          await refresh();
          if (id) await syncClientPushToken(client, id).catch(() => {});
        } else if (fix === "fullScreen") {
          await openFullScreenSettings();
          await refresh();
        } else if (fix === "dnd") {
          await openDndAccessSettings();
          await refresh();
        } else {
          if (id) await syncClientPushToken(client, id);
        }
      },
      openBattery: () => Linking.openSettings(),
      sendTest: async (delaySeconds) => {
        const sent = (await client.mutation(anyApi.alerts.sendTest, { clientId: needClient(), delaySeconds })) as {
          questionId: string;
        };
        return sent.questionId;
      },
      signOut: onSignOut,
    };
  }, [client, id, email, clients, settings, health, about, refresh, onSignOut]);

  // What became of the test page S5 sent. While the alert is on screen it is answered there.
  const alert = useQuery(anyApi.alerts.get, id && nav.testId ? { clientId: id, questionId: nav.testId } : "skip") as
    | TestAlertView
    | null
    | undefined;
  const testStatus: TestPageStatus = nav.testId === null ? { kind: "idle" } : testPageStatus(alert);

  const onNavStable = useCallback((next: SettingsNav) => onNav(next), [onNav]);
  return <SettingsHost source={source} nav={nav} onNav={onNavStable} testStatus={testStatus} onClose={onClose} />;
}
