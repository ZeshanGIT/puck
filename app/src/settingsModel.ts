/**
 * The choices behind the Settings screens (S1 to S7): what each row says, the chips for the
 * global bypass settings and the ring length, the alert-health checks and their fixes, the client
 * list, the test page result, the rename rules and the version text. Nothing here imports React
 * Native, so it is tested with `bun test`. The screens (`S1Settings.tsx` ...) only draw it.
 *
 * Where each setting lives (Protocol changes section 6): the bypass modes and the ring length
 * stay on the phone (`localSettings.ts`); the client list, names and flags are on the backend.
 */
import { dateText } from "./botsModel";
import type { BypassMode } from "./localSettings";

/* ------------------------------------------------------------------- S4 chips */

export const GLOBAL_BYPASS_CHIPS: readonly { id: BypassMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "urgent", label: "Urgent only" },
  { id: "all", label: "All alerts" },
];

/** The prototype's "30 s", "60 s" and "2 min". */
export const RING_CHIPS: readonly { seconds: number; label: string }[] = [
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "60 s" },
  { seconds: 120, label: "2 min" },
];

/** The chip that matches the stored ring length, or null for a length no chip offers. */
export function selectedRingChip(seconds: number): number | null {
  return RING_CHIPS.some((chip) => chip.seconds === seconds) ? seconds : null;
}

/* ------------------------------------------------------------------- S7 about */

export interface VersionInfo {
  /** "Puck 1.0.0" */
  title: string;
  /** "41 · debug" or "release" when the build number is not known. */
  build: string;
}

/** The About screen's version text. `build` is the native build number when the build knows it. */
export function versionText(input: { version: string | null | undefined; build: string | null | undefined; dev: boolean }): VersionInfo {
  const version = input.version?.trim() || "unknown";
  const kind = input.dev ? "debug" : "release";
  const build = input.build?.trim();
  return { title: `Puck ${version}`, build: build ? `${build} · ${kind}` : kind };
}

/** "usable-mule-44" from "https://usable-mule-44.convex.cloud": the deployment name. */
export function backendName(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] || url;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------- S2 and S3 clients */

export interface ClientItem {
  id: string;
  name: string;
  platform: "android" | "cli";
  fullScreenAllowed?: boolean;
  dndAccess?: boolean;
  /** Whether a push token is stored. Undefined from a backend that does not say yet. */
  hasPushToken?: boolean;
  lastSeenAt: number;
  createdAt: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now", "4 min ago", "3 h ago", "2 d ago". */
export function lastSeenText(lastSeenAt: number, now: number): string {
  const ago = Math.max(0, now - lastSeenAt);
  if (ago < MINUTE) return "Just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  return `${Math.floor(ago / DAY)} d ago`;
}

/** S2's "Registered" value: "Today", "Yesterday", or the date. Calendar days in local time. */
export function registeredText(createdAt: number, now: number): string {
  const startOfDay = (at: number) => {
    const date = new Date(at);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(createdAt)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return dateText(createdAt);
}

export interface ClientRowModel {
  id: string;
  name: string;
  platform: "android" | "cli";
  isThis: boolean;
  /** "This phone", or "Last seen 4 min ago". */
  subtitle: string;
  /** Another client can be removed here; this phone leaves through Sign out. */
  removable: boolean;
}

/** S3's rows: this phone first, then the others, most recently seen first. */
export function clientRows(clients: readonly ClientItem[], thisClientId: string | null, now: number): ClientRowModel[] {
  const sorted = [...clients].sort((a, b) => {
    if (a.id === thisClientId) return -1;
    if (b.id === thisClientId) return 1;
    return b.lastSeenAt - a.lastSeenAt;
  });
  return sorted.map((client) => {
    const isThis = client.id === thisClientId;
    return {
      id: client.id,
      name: client.name,
      platform: client.platform,
      isThis,
      subtitle: isThis ? "This phone" : `Last seen ${lastSeenText(client.lastSeenAt, now)}`,
      removable: !isThis,
    };
  });
}

/** S1's "Other clients" value: how many besides this phone. */
export function otherClientCount(clients: readonly ClientItem[] | undefined, thisClientId: string | null): number | null {
  if (clients === undefined) return null;
  return clients.filter((client) => client.id !== thisClientId).length;
}

/** This phone's own row, if the list has it. */
export function thisClient(clients: readonly ClientItem[] | undefined, thisClientId: string | null): ClientItem | null {
  if (!clients || thisClientId === null) return null;
  return clients.find((client) => client.id === thisClientId) ?? null;
}

/** Same rules as `validateClientName` on the backend: trimmed, 1 to 40 characters, one line. */
export const CLIENT_NAME_MAX = 40;
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export type RenameCheck = { ok: true; name: string } | { ok: false; message: string };

export function checkClientName(raw: string, taken: readonly string[] = []): RenameCheck {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, message: "Give this phone a name" };
  if ([...name].length > CLIENT_NAME_MAX) return { ok: false, message: `Keep it to ${CLIENT_NAME_MAX} characters` };
  if (NOT_ONE_LINE.test(name)) return { ok: false, message: "Use one line" };
  if (taken.some((other) => other === name)) return { ok: false, message: "Another client already has that name" };
  return { ok: true, name };
}

/** S2's "Push" row. */
export function pushRow(hasPushToken: boolean | undefined): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (hasPushToken === true) return { text: "Connected", tone: "ok" };
  if (hasPushToken === false) return { text: "Not connected", tone: "warn" };
  return { text: "Unknown", tone: "neutral" };
}

/* ------------------------------------------------------------------ S5 health */

/** Everything S5 needs to know about this phone, each `null` while unknown (not read yet, or an older build). */
export interface HealthSnapshot {
  notifications: boolean | null;
  fullScreen: boolean | null;
  /** Android's Do Not Disturb access (`hasDndAccess`). */
  dndAccess: boolean | null;
  /** Some bypass setting lets alerts through Do Not Disturb (`dndBypassActive`). */
  dndNeeded: boolean;
  /** This phone's client row is on the account. */
  registered: boolean | null;
  /** A push token is stored for this phone. */
  pushToken: boolean | null;
  /** The connection to the backend is up. */
  online: boolean;
}

/** What the client list says about this phone: is its row on the account, and does it hold a push token. */
export function clientHealth(
  clients: readonly ClientItem[] | undefined,
  thisClientId: string | null,
): { registered: boolean | null; pushToken: boolean | null } {
  if (thisClientId === null) return { registered: false, pushToken: false };
  if (clients === undefined) return { registered: null, pushToken: null };
  const row = clients.find((client) => client.id === thisClientId);
  if (!row) return { registered: false, pushToken: false };
  return { registered: true, pushToken: row.hasPushToken ?? null };
}

export type HealthCheckId = "notifications" | "fullScreen" | "dnd" | "registered" | "push" | "network";
export type HealthFixId = "notifications" | "fullScreen" | "dnd" | "push" | "signIn";
/** "unknown" is not a problem: the build or the moment cannot tell. */
export type HealthState = "ok" | "bad" | "unknown";

export interface HealthCheck {
  id: HealthCheckId;
  label: string;
  state: HealthState;
  /** What is wrong, or what "ok" means. S5 shows it under the label when the check is not ok. */
  detail: string;
  fix?: { id: HealthFixId; label: string };
}

function tri(value: boolean | null, ok: Omit<HealthCheck, "state">, bad: Omit<HealthCheck, "state">): HealthCheck {
  if (value === null) return { ...ok, state: "unknown", detail: "Can't tell yet", fix: undefined };
  return value ? { ...ok, state: "ok" } : { ...bad, state: "bad" };
}

/** The prototype's six rows plus the fix each one offers. Order is the order on screen. */
export function healthChecks(snapshot: HealthSnapshot): HealthCheck[] {
  const checks: HealthCheck[] = [];
  checks.push(
    tri(
      snapshot.notifications,
      { id: "notifications", label: "Notifications", detail: "On" },
      {
        id: "notifications",
        label: "Notifications",
        detail: "Off, so bots can't reach you while Puck is closed",
        fix: { id: "notifications", label: "Turn on" },
      },
    ),
  );
  checks.push(
    tri(
      snapshot.fullScreen,
      { id: "fullScreen", label: "Show over the lock screen", detail: "Allowed" },
      {
        id: "fullScreen",
        label: "Show over the lock screen",
        detail: "Alerts can't take over the screen",
        fix: { id: "fullScreen", label: "Allow" },
      },
    ),
  );
  // Do Not Disturb access only matters while some setting lets alerts through it (H3, Q6).
  if (snapshot.dndAccess === false && !snapshot.dndNeeded) {
    checks.push({
      id: "dnd",
      label: "Do Not Disturb access",
      state: "ok",
      detail: "Not needed while no alert may bypass Do Not Disturb",
    });
  } else {
    checks.push(
      tri(
        snapshot.dndAccess,
        { id: "dnd", label: "Do Not Disturb access", detail: "Allowed" },
        {
          id: "dnd",
          label: "Do Not Disturb access",
          detail: "Alerts allowed through Do Not Disturb can't ring",
          fix: { id: "dnd", label: "Allow" },
        },
      ),
    );
  }
  checks.push(
    tri(
      snapshot.registered,
      { id: "registered", label: "Signed in and registered", detail: "This phone is on your account" },
      {
        id: "registered",
        label: "Signed in and registered",
        detail: "This phone is no longer on your account",
        fix: { id: "signIn", label: "Sign in" },
      },
    ),
  );
  const pushBad: Omit<HealthCheck, "state"> =
    snapshot.notifications === false
      ? { id: "push", label: "Push connected", detail: "Turn notifications on first" }
      : { id: "push", label: "Push connected", detail: "This phone has no push token yet", fix: { id: "push", label: "Fix" } };
  checks.push(tri(snapshot.pushToken, { id: "push", label: "Push connected", detail: "Connected" }, pushBad));
  checks.push({
    id: "network",
    label: "Network",
    state: snapshot.online ? "ok" : "bad",
    detail: snapshot.online ? "Connected to Puck" : "Offline. Answers wait on this phone and send when you're back",
  });
  return checks;
}

export function problemCount(checks: readonly HealthCheck[]): number {
  return checks.filter((check) => check.state === "bad").length;
}

/** S5's headline: "Puck can reach you", "One thing needs you", "2 things need you". */
export function healthTitle(checks: readonly HealthCheck[]): string {
  const bad = problemCount(checks);
  if (bad === 0) return "Puck can reach you";
  if (bad === 1) return "One thing needs you";
  return `${bad} things need you`;
}

/** S1's "Alert health" value: "All good" or "Needs you"; null before the first read. */
export function healthRowValue(snapshot: HealthSnapshot | undefined): { text: string; tone: "ok" | "warn" } | null {
  if (!snapshot) return null;
  return problemCount(healthChecks(snapshot)) === 0 ? { text: "All good", tone: "ok" } : { text: "Needs you", tone: "warn" };
}

/* ----------------------------------------------------------------- test page */

export type TestPageStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  /** Sent; the page is on its way or on screen, not answered yet. */
  | { kind: "waiting" }
  | { kind: "answered"; heardYou: boolean; at: number }
  /** Cancelled or expired without an answer. */
  | { kind: "missed" }
  | { kind: "error"; message: string };

/** The part of `alerts.get` the test page result needs. */
export interface TestAlertView {
  status: string;
  options: readonly { id: string; chosen: boolean }[];
  answer: { answeredAt: number } | null;
}

/**
 * What S5 says about the test page it sent. `alert` is `alerts.get` for the page's question id:
 * undefined while it loads, null when it is not found.
 */
export function testPageStatus(alert: TestAlertView | null | undefined): TestPageStatus {
  if (alert === undefined || alert === null) return { kind: "waiting" };
  if (alert.answer) {
    const chosen = alert.options.find((option) => option.chosen);
    return { kind: "answered", heardYou: chosen?.id === "yes", at: alert.answer.answeredAt };
  }
  if (alert.status === "cancelled" || alert.status === "expired") return { kind: "missed" };
  return { kind: "waiting" };
}

/** The line under the test button. */
export function testPageLine(status: TestPageStatus, timeText: (at: number) => string): string | null {
  switch (status.kind) {
    case "idle":
      return null;
    case "sending":
      return "Sending…";
    case "waiting":
      return "Sent. Waiting for your answer…";
    case "answered":
      return status.heardYou
        ? `It works. You answered at ${timeText(status.at)}.`
        : `You answered Not really at ${timeText(status.at)}. Check what is marked above.`;
    case "missed":
      return "The test page went unanswered.";
    case "error":
      return status.message;
  }
}
