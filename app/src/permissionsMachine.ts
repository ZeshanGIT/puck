/**
 * The O2 permissions check, in one place.
 *
 * The screen reads three switches (notifications, show over the lock screen, get through Do Not
 * Disturb) every time the person comes back to the app. This machine remembers what was seen last
 * and, for each new reading, decides what to do about what changed. It returns plain-data effects
 * and the screen performs them in order:
 *
 *   unseen   --read-----------------------> watching  (first look: record the current state only)
 *   watching --read-----------------------> watching  (toasts and client flag syncs for changes)
 *   watching --leftForDndSettings---------> awaitingDnd
 *   awaitingDnd --dndLaunchFailed---------> watching
 *   awaitingDnd --appResumed(dnd)---------> watching  (toast unless access is known to be off)
 *
 * Do Not Disturb access has no JS check on a build without the native function, so `dnd` is null
 * there: nothing is synced for it, and the row ticks as "asked" once the person returns from the
 * system screen (`dndAsked`), whether or not they turned it on.
 *
 * `effects` belongs to the last transition only: every event replaces it, so it is empty when
 * nothing needs doing.
 */
import { defineMachine } from "@puck/shared";

/** One look at the three switches. `dnd` is null on a build without the native function. */
export interface PermissionsReading {
  notification: boolean;
  fullScreen: boolean;
  dnd: boolean | null;
}

export type PermissionsEffect =
  | { kind: "toast"; text: string }
  /** `setFlags({ dndAccess })` on the client row. */
  | { kind: "syncDndFlag"; value: boolean }
  /** `setFlags({ fullScreenAllowed })` on the client row. */
  | { kind: "syncFullScreenFlag"; value: boolean }
  | { kind: "syncPushToken" }
  /** Records the current full-screen state on the client row (first look only). */
  | { kind: "syncClientFullScreen" };

export interface PermissionsState {
  /** What was last seen, or null before the first look. */
  seen: PermissionsReading | null;
  /** True between opening the Do Not Disturb system screen and coming back. */
  dndLaunched: boolean;
  /** True once the person has returned from the Do Not Disturb system screen. */
  dndAsked: boolean;
  /** What the screen should do for the event that produced this state, in order. */
  effects: PermissionsEffect[];
}

export type PermissionsEvent =
  | ({ type: "read" } & PermissionsReading)
  | { type: "leftForDndSettings" }
  | { type: "dndLaunchFailed" }
  /** `dnd`: Do Not Disturb access as read at the moment the app came back to the foreground. */
  | { type: "appResumed"; dnd: boolean | null };

export const NOTIFICATIONS_ON_TOAST = "Notifications on";
export const FULL_SCREEN_ALLOWED_TOAST = "Full-screen alerts allowed";
export const DND_ALLOWED_TOAST = "Do Not Disturb access allowed";

function afterRead(state: PermissionsState, now: PermissionsReading): PermissionsState {
  const before = state.seen;
  const effects: PermissionsEffect[] = [];
  if (!before) {
    // First look: record the current state on the client row so an urgent alert can ring.
    effects.push({ kind: "syncClientFullScreen" });
    if (now.dnd !== null) effects.push({ kind: "syncDndFlag", value: now.dnd });
    return { ...state, seen: now, effects };
  }
  if (now.dnd !== before.dnd && now.dnd !== null) effects.push({ kind: "syncDndFlag", value: now.dnd });
  if (now.notification && !before.notification) {
    effects.push({ kind: "toast", text: NOTIFICATIONS_ON_TOAST }, { kind: "syncPushToken" });
  }
  if (now.fullScreen && !before.fullScreen) effects.push({ kind: "toast", text: FULL_SCREEN_ALLOWED_TOAST });
  if (now.fullScreen !== before.fullScreen) effects.push({ kind: "syncFullScreenFlag", value: now.fullScreen });
  return { ...state, seen: now, effects };
}

/** Pure and total: the new state, with the effects the screen must perform in `effects`. */
export function transitionPermissions(state: PermissionsState, event: PermissionsEvent): PermissionsState {
  switch (event.type) {
    case "read":
      return afterRead(state, { notification: event.notification, fullScreen: event.fullScreen, dnd: event.dnd });
    case "leftForDndSettings":
      return { ...state, dndLaunched: true, effects: [] };
    case "dndLaunchFailed":
      return { ...state, dndLaunched: false, effects: [] };
    case "appResumed":
      if (!state.dndLaunched) return { ...state, effects: [] };
      return {
        ...state,
        dndLaunched: false,
        dndAsked: true,
        effects: event.dnd !== false ? [{ kind: "toast", text: DND_ALLOWED_TOAST }] : [],
      };
  }
}

export const permissionsCheck = defineMachine<PermissionsState, PermissionsEvent>({
  name: "permissions-check",
  summary:
    "O2 permissions screen: remembers the last reading of notifications, full-screen and Do Not Disturb, and turns each change into toasts and client flag syncs.",
  usedBy: ["app/src/screens/O2Permissions.tsx"],
  initial: { seen: null, dndLaunched: false, dndAsked: false, effects: [] },
  transition: transitionPermissions,
  label: (state) => (state.seen === null ? "unseen" : state.dndLaunched ? "awaitingDnd" : "watching"),
  invariant: (state) => (state.seen === null && state.effects.length > 0 ? "effects before the first look" : null),
  samples: {
    states: [
      { seen: null, dndLaunched: false, dndAsked: false, effects: [] },
      {
        seen: { notification: false, fullScreen: false, dnd: false },
        dndLaunched: false,
        dndAsked: false,
        effects: [],
      },
      {
        seen: { notification: true, fullScreen: true, dnd: null },
        dndLaunched: true,
        dndAsked: false,
        effects: [{ kind: "syncPushToken" }],
      },
    ],
    events: [
      { type: "read", notification: true, fullScreen: true, dnd: true },
      { type: "read", notification: false, fullScreen: false, dnd: null },
      { type: "leftForDndSettings" },
      { type: "dndLaunchFailed" },
      { type: "appResumed", dnd: false },
      { type: "appResumed", dnd: null },
    ],
  },
});
