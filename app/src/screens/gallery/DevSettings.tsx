/**
 * The Settings screens on fake data (`sample=settings`, `this-phone`, `clients`, `sounds`, `health`,
 * `health-ok`, `about`): no backend. Every change works on the fake data: chips, Rename, Remove,
 * Turn on and Allow (they flip the fake state), and the test page, which "answers" three seconds
 * after it is sent. Dev builds only (see `App.tsx`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { dndBypassActive } from "../../homeModel";
import { clientHealth, type ClientItem, type TestPageStatus } from "../../settingsModel";
import type { LocalSettings } from "../../localSettings";
import { Toast, useToast } from "../../ui/Toast";
import { SettingsHost, type SettingsNav, type SettingsSource } from "../SettingsHost";
import { freshSettings, SAMPLE_THIS_CLIENT_ID } from "./samples/settings";

export function DevSettings({ name }: { name: string }) {
  const toast = useToast();
  const { show } = toast;
  const [round, setRound] = useState(() => Date.now());
  const sample = useMemo(() => freshSettings(name, round), [name, round]);
  const [clients, setClients] = useState<ClientItem[]>(() => sample?.clients ?? []);
  const [settings, setSettings] = useState<LocalSettings>(() => sample?.settings ?? ({} as LocalSettings));
  const [phone, setPhone] = useState(() => ({
    notifications: sample?.health.notifications ?? null,
    fullScreen: sample?.health.fullScreen ?? null,
    dndAccess: sample?.health.dndAccess ?? null,
    online: sample?.health.online ?? true,
  }));
  const [nav, setNav] = useState<SettingsNav>(() => ({ route: sample?.route ?? "home", testId: null }));
  const [testStatus, setTestStatus] = useState<TestPageStatus>({ kind: "idle" });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const source = useMemo<SettingsSource>(
    () => ({
      email: sample?.email ?? null,
      clientId: SAMPLE_THIS_CLIENT_ID,
      clients,
      settings,
      health: {
        ...phone,
        dndNeeded: dndBypassActive(settings),
        ...clientHealth(clients, SAMPLE_THIS_CLIENT_ID),
      },
      about: { title: "Puck 1.0.0", build: "1 · debug", backend: "usable-mule-44", devInfo: [{ label: "Client id", value: SAMPLE_THIS_CLIENT_ID }] },
      setSettings: async (change) => setSettings((all) => ({ ...all, ...change })),
      rename: async (next) =>
        setClients((all) => all.map((client) => (client.id === SAMPLE_THIS_CLIENT_ID ? { ...client, name: next } : client))),
      removeClient: async (id) => setClients((all) => all.filter((client) => client.id !== id)),
      openSound: async (kind) => {
        show(`Would open Android's ${kind} sound settings`);
        return true;
      },
      fix: async (fix) => {
        show(`Sample: ${fix} fixed`);
        if (fix === "notifications") setPhone((all) => ({ ...all, notifications: true }));
        else if (fix === "fullScreen") setPhone((all) => ({ ...all, fullScreen: true }));
        else if (fix === "dnd") setPhone((all) => ({ ...all, dndAccess: true }));
        else
          setClients((all) =>
            all.map((client) => (client.id === SAMPLE_THIS_CLIENT_ID ? { ...client, hasPushToken: true } : client)),
          );
      },
      openBattery: async () => show("Would open Puck's app settings"),
      sendTest: async (delaySeconds) => {
        const testId = `sample-test-${Date.now()}`;
        setTestStatus({ kind: "waiting" });
        timers.current.push(
          setTimeout(() => setTestStatus({ kind: "answered", heardYou: true, at: Date.now() }), (delaySeconds + 3) * 1000),
        );
        return testId;
      },
      signOut: () => {
        show("Sample: would sign out. Starting again");
        timers.current.push(setTimeout(() => restart(), 1200));
      },
    }),
    [clients, settings, phone, sample, show],
  );

  function restart() {
    const next = Date.now();
    const fresh = freshSettings(name, next);
    setClients(fresh?.clients ?? []);
    if (fresh) {
      setSettings(fresh.settings);
      setPhone({
        notifications: fresh.health.notifications,
        fullScreen: fresh.health.fullScreen,
        dndAccess: fresh.health.dndAccess,
        online: fresh.health.online,
      });
    }
    setNav({ route: fresh?.route ?? "home", testId: null });
    setTestStatus({ kind: "idle" });
    setRound(next);
  }

  if (!sample) return null;
  return (
    <View style={styles.root}>
      <SettingsHost
        key={round}
        source={source}
        nav={nav}
        onNav={setNav}
        testStatus={nav.testId === null ? { kind: "idle" } : testStatus}
        onClose={() => {
          show("Sample over. Starting again");
          timers.current.push(setTimeout(() => restart(), 1200));
        }}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
