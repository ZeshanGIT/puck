/**
 * Runs the Settings screens: S1 (the list) and S2 to S5 and S7 under it, plus the sign-out sheet
 * (S6). Back from a sub-screen goes to S1 and back from S1 goes to where Settings was opened
 * (Home); the Android back gesture does the same. It takes a `SettingsSource` (the values, and
 * what changes them) so the same screens run on Convex (`ConnectedSettingsHost`) and on fake data
 * in the dev gallery (`gallery/DevSettings.tsx`).
 *
 * Where the screen is lives with the caller (`nav`, `onNav`): an alert that takes over the screen
 * (the test page, in S5) unmounts the host, and Settings is where it was when the alert is done.
 *
 * What is stored where: the bypass settings and the ring length on the phone (`localSettings.ts`);
 * names and the client list on the backend (`clients.rename`, `clients.remove`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import type { SoundKind } from "../botSoundSettings";
import type { LocalSettings } from "../localSettings";
import {
  healthRowValue,
  otherClientCount,
  thisClient,
  type ClientItem,
  type HealthFixId,
  type HealthSnapshot,
  type TestPageStatus,
} from "../settingsModel";
import { readableError } from "../session";
import { Toast, useToast } from "../ui/Toast";
import { S1Settings } from "./S1Settings";
import { S2ThisPhone } from "./S2ThisPhone";
import { S3Clients } from "./S3Clients";
import { S4Sounds } from "./S4Sounds";
import { S5Health } from "./S5Health";
import { S6SignOutSheet } from "./S6SignOutSheet";
import { S7About } from "./S7About";

export type SettingsRoute = "home" | "this-phone" | "clients" | "sounds" | "health" | "about";

/** Where Settings is: the screen, and the test page S5 sent (so its result survives the alert taking over). */
export interface SettingsNav {
  route: SettingsRoute;
  testId: string | null;
}

export const SETTINGS_HOME: SettingsNav = { route: "home", testId: null };

/** The settings the Sounds screen changes. */
export type SettingsChange = Partial<Pick<LocalSettings, "bypassDnd" | "bypassSilent" | "ringSeconds">>;

export interface SettingsSource {
  email: string | null;
  /** This phone's client id; null on the legacy path with no client row. */
  clientId: string | null;
  /** The account's clients; undefined while they load. */
  clients: readonly ClientItem[] | undefined;
  /** The phone's own settings (bypass modes, ring length). */
  settings: LocalSettings;
  health: HealthSnapshot | undefined;
  /** "Puck 1.0.0", the build text, the backend name, and extra dev rows. */
  about: { title: string; build: string; backend: string; devInfo?: readonly { label: string; value: string }[] };
  setSettings: (change: SettingsChange) => Promise<void>;
  /** Renames this phone. */
  rename: (name: string) => Promise<void>;
  removeClient: (clientId: string) => Promise<void>;
  /** Opens Android's sound settings; resolves false when it could not. */
  openSound: (kind: SoundKind) => Promise<boolean>;
  /** Turn on or Allow: opens the system screen (or does the fix) for one health check. */
  fix: (id: Exclude<HealthFixId, "signIn">) => Promise<void>;
  /** Opens the app's settings (battery use). */
  openBattery: () => Promise<void>;
  /** Sends the test page; resolves with its question id. */
  sendTest: (delaySeconds: number) => Promise<string>;
  /** Signs out of Puck on this phone. */
  signOut: () => void;
}

export interface SettingsHostProps {
  source: SettingsSource;
  nav: SettingsNav;
  onNav: (nav: SettingsNav) => void;
  /** What became of the test page named in `nav.testId`; "idle" with none. */
  testStatus: TestPageStatus;
  /** Back from S1. */
  onClose: () => void;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "14:02": the 24-hour times the rest of the app shows. */
export function timeText(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function SettingsHost({ source, nav, onNav, testStatus, onClose }: SettingsHostProps) {
  const now = useNow(30_000);
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const { route } = nav;
  const { clients, clientId, settings } = source;
  const phone = thisClient(clients, clientId);

  const go = useCallback(
    (next: SettingsRoute) => {
      setError(null);
      onNav({ ...nav, route: next });
    },
    [nav, onNav],
  );
  const back = useCallback(() => {
    setError(null);
    if (route !== "home") onNav({ ...nav, route: "home" });
    else onClose();
  }, [route, nav, onNav, onClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(readableError(caught));
    }
  }, []);

  const otherNames = useMemo(
    () => (clients ?? []).filter((client) => client.id !== clientId).map((client) => client.name),
    [clients, clientId],
  );

  const test: TestPageStatus = sending ? { kind: "sending" } : sendError ? { kind: "error", message: sendError } : testStatus;

  async function sendTest(delaySeconds: number) {
    setSending(true);
    setSendError(null);
    try {
      const testId = await source.sendTest(delaySeconds);
      onNav({ ...nav, testId });
      if (delaySeconds > 0) toast.show(`Lock your phone now. Paging you in ${delaySeconds} seconds.`);
    } catch (caught) {
      setSendError(readableError(caught));
    } finally {
      setSending(false);
    }
  }

  let screen;
  switch (route) {
    case "this-phone":
      screen = (
        <S2ThisPhone
          client={clients === undefined && clientId !== null ? undefined : phone}
          otherNames={otherNames}
          now={now}
          onRename={async (name) => {
            try {
              await source.rename(name);
              toast.show("Renamed");
              return null;
            } catch (caught) {
              return readableError(caught);
            }
          }}
          onRemove={() => setSigningOut(true)}
          onBack={back}
        />
      );
      break;
    case "clients":
      screen = (
        <S3Clients
          clients={clients}
          thisClientId={clientId}
          now={now}
          removingId={removingId}
          error={error}
          onRemove={(id) => {
            const name = (clients ?? []).find((client) => client.id === id)?.name ?? "Client";
            setRemovingId(id);
            void run(async () => {
              await source.removeClient(id);
              toast.show(`${name} removed`);
            }).finally(() => setRemovingId(null));
          }}
          onBack={back}
        />
      );
      break;
    case "sounds":
      screen = (
        <S4Sounds
          ringSeconds={settings.ringSeconds}
          bypassDnd={settings.bypassDnd}
          bypassSilent={settings.bypassSilent}
          error={error}
          onSound={(kind) =>
            void source.openSound(kind).then((ok) => {
              if (!ok) toast.show("Couldn't open Android's sound settings");
            })
          }
          onRing={(ringSeconds) => void run(() => source.setSettings({ ringSeconds }))}
          onBypassDnd={(bypassDnd) => void run(() => source.setSettings({ bypassDnd }))}
          onBypassSilent={(bypassSilent) => void run(() => source.setSettings({ bypassSilent }))}
          onBack={back}
        />
      );
      break;
    case "health":
      screen = (
        <S5Health
          snapshot={source.health}
          test={test}
          timeText={timeText}
          onFix={(id) => {
            if (id === "signIn") setSigningOut(true);
            else void run(() => source.fix(id));
          }}
          onSendTest={(delaySeconds) => void sendTest(delaySeconds)}
          onBattery={() => void source.openBattery()}
          onBack={back}
        />
      );
      break;
    case "about":
      screen = <S7About {...source.about} onBack={back} />;
      break;
    default:
      screen = (
        <S1Settings
          email={source.email}
          phoneName={phone?.name}
          otherClients={otherClientCount(clients, clientId)}
          health={healthRowValue(source.health)}
          version={source.about.title.replace(/^Puck /u, "")}
          onThisPhone={() => go("this-phone")}
          onClients={() => go("clients")}
          onSounds={() => go("sounds")}
          onHealth={() => go("health")}
          onAbout={() => go("about")}
          onSignOut={() => setSigningOut(true)}
          onBack={back}
        />
      );
  }

  return (
    <View style={styles.fill}>
      {screen}
      <S6SignOutSheet
        visible={signingOut}
        onClose={() => setSigningOut(false)}
        onConfirm={() => {
          setSigningOut(false);
          source.signOut();
        }}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
