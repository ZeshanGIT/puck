/**
 * Alert launch: what the inbox does with the alert a notification (or the compact card) opened.
 *
 *   idle --opened--> waiting --(on the deck)--> shown --(left the list)--> done
 *                       |--(listed but kept off the deck)--> done
 *                       `--(never showed up in time)--> done
 *
 * While `waiting` or `shown`, the inbox prefers that alert and never falls back to another one, so
 * a launch does not flash Home or the wrong alert while Convex and the deck catch up
 * (`pickDeckAlert`). `done` means the launch is over: normal routing (the oldest live alert takes
 * the screen) is back.
 *
 * Before this machine the opened id was only ever overwritten, never cleared, so after the opened
 * alert was answered a later single alert stayed under Needs you until the app restarted, and a
 * launched alert that the deck dropped (its A9 card closed, or answered offline) left a blank
 * screen with no way out. The three ways out are the `done` arrows above.
 *
 * `opened` is idempotent: the inbox applies it on every render with the id the notification hook
 * holds, so a launch is visible on the very first render and no frame shows Home first.
 */
import { defineMachine } from "@puck/shared";

/** How long a launch waits for its alert to appear in the pending list before it gives up. */
export const LAUNCH_GIVE_UP_MS = 6000;

export type AlertLaunchState =
  | { phase: "idle"; id: null }
  | { phase: "waiting" | "shown" | "done"; id: string };

export type AlertLaunchEvent =
  | { type: "opened"; id: string | null }
  | {
      type: "observed";
      /** The pending list and the visible list have both loaded. */
      loaded: boolean;
      /** The launched alert is in the pending list. */
      inPending: boolean;
      /** The launched alert is in the deck's live list (not hidden, not queued locally). */
      inLive: boolean;
      /** The launched alert is the one on the deck (or held there for its receipt). */
      onDeck: boolean;
    }
  | { type: "gaveUp" };

export const initialAlertLaunch: AlertLaunchState = { phase: "idle", id: null };

export function alertLaunchTransition(state: AlertLaunchState, event: AlertLaunchEvent): AlertLaunchState {
  switch (event.type) {
    case "opened":
      if (event.id === null || event.id === state.id) return state;
      return { phase: "waiting", id: event.id };
    case "gaveUp":
      return state.phase === "waiting" ? { phase: "done", id: state.id } : state;
    case "observed": {
      if (state.phase === "idle" || state.phase === "done" || !event.loaded) return state;
      if (event.onDeck) return state.phase === "shown" ? state : { phase: "shown", id: state.id };
      if (state.phase === "shown" && !event.inLive) return { phase: "done", id: state.id };
      if (state.phase === "waiting" && event.inPending && !event.inLive) return { phase: "done", id: state.id };
      return state;
    }
  }
}

/** The alert id the inbox must prefer right now, or null when routing is back to normal. */
export function launchIdOf(state: AlertLaunchState): string | null {
  return state.phase === "waiting" || state.phase === "shown" ? state.id : null;
}

export const alertLaunch = defineMachine<AlertLaunchState, AlertLaunchEvent>({
  name: "alert-launch",
  summary:
    "The alert a notification or the compact card opened: preferred while it loads and shows, then released so normal routing resumes.",
  usedBy: ["app/src/Inbox.tsx", "app/src/alertLaunchRouting.ts", "app/src/push.ts"],
  initial: initialAlertLaunch,
  transition: alertLaunchTransition,
  label: (state) => state.phase,
  invariant: (state) => (state.phase === "idle" ? (state.id === null ? null : "idle with an id") : state.id ? null : "no id"),
  samples: {
    states: [
      { phase: "waiting", id: "q_AAA" },
      { phase: "shown", id: "q_AAA" },
      { phase: "done", id: "q_AAA" },
    ],
    events: [
      { type: "opened", id: "q_BBB" },
      { type: "opened", id: null },
      { type: "observed", loaded: true, inPending: true, inLive: true, onDeck: true },
      { type: "observed", loaded: true, inPending: true, inLive: false, onDeck: false },
      { type: "observed", loaded: true, inPending: false, inLive: false, onDeck: false },
      { type: "observed", loaded: false, inPending: false, inLive: false, onDeck: false },
      { type: "gaveUp" },
    ],
  },
});
