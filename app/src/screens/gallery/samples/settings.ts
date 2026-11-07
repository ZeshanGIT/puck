/**
 * Samples for the Settings screens (S1 to S7), with no backend: `puck://dev-alert?sample=<name>`
 * (dev builds only, see `App.tsx`). They run the real screens (`SettingsHost`) on fake data, in
 * `gallery/DevSettings.tsx`: chips store, Rename and Remove work on the fake list, Allow and Turn on
 * flip the fake state, and the test page answers itself a few seconds after it is sent.
 *
 * - `settings`: S1, everything fine except Alert health (it needs you).
 * - `this-phone`: S2.
 * - `clients`: S3 with this phone, a CLI session and an old phone.
 * - `sounds`: S4.
 * - `health`: S5 with a mix of ok and failing checks (lock screen and Do Not Disturb off).
 * - `health-ok`: S5 with everything fine.
 * - `about`: S7.
 *
 * Times are relative to the moment a sample is opened; `freshSettings` turns them into real times.
 */
import { DEFAULT_LOCAL_SETTINGS, type LocalSettings } from "../../../localSettings";
import type { ClientItem, HealthSnapshot } from "../../../settingsModel";
import type { SettingsRoute } from "../../SettingsHost";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SETTINGS_SAMPLE_NAMES = ["settings", "this-phone", "clients", "sounds", "health", "health-ok", "about"] as const;

export function isSettingsSample(name: string): boolean {
  return (SETTINGS_SAMPLE_NAMES as readonly string[]).includes(name);
}

export const SAMPLE_THIS_CLIENT_ID = "sample-pixel-7";

export interface SettingsSample {
  route: SettingsRoute;
  clients: ClientItem[];
  settings: LocalSettings;
  health: HealthSnapshot;
  email: string;
}

const ALL_OK: HealthSnapshot = {
  notifications: true,
  fullScreen: true,
  dndAccess: true,
  dndNeeded: true,
  registered: true,
  pushToken: true,
  online: true,
};

function sampleClients(now: number): ClientItem[] {
  return [
    {
      id: SAMPLE_THIS_CLIENT_ID,
      name: "Pixel 7",
      platform: "android",
      fullScreenAllowed: true,
      hasPushToken: true,
      lastSeenAt: now,
      createdAt: now - 3 * DAY,
    },
    {
      id: "sample-macbook",
      name: "MacBook · CLI",
      platform: "cli",
      hasPushToken: false,
      lastSeenAt: now - 4 * MINUTE,
      createdAt: now - 20 * DAY,
    },
    {
      id: "sample-old-phone",
      name: "Old phone",
      platform: "android",
      hasPushToken: true,
      lastSeenAt: now - 30 * HOUR,
      createdAt: now - 60 * DAY,
    },
  ];
}

/** The named sample, or null for an unknown name. */
export function freshSettings(name: string, now: number = Date.now()): SettingsSample | null {
  if (!isSettingsSample(name)) return null;
  const base = {
    clients: sampleClients(now),
    settings: { ...DEFAULT_LOCAL_SETTINGS, bots: {} },
    email: "zeshan.nandan@gmail.com",
  };
  switch (name) {
    case "settings":
      return { ...base, route: "home", health: { ...ALL_OK, fullScreen: false } };
    case "this-phone":
      return { ...base, route: "this-phone", health: ALL_OK };
    case "clients":
      return { ...base, route: "clients", health: ALL_OK };
    case "sounds":
      return { ...base, route: "sounds", health: ALL_OK };
    case "health":
      return { ...base, route: "health", health: { ...ALL_OK, fullScreen: false, dndAccess: false } };
    case "health-ok":
      return { ...base, route: "health", health: ALL_OK };
    default:
      return { ...base, route: "about", health: ALL_OK };
  }
}
