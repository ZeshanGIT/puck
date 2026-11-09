/**
 * The O3 test page, in one place.
 *
 *   clearing --clearedOldPages-----------> idle     (old test pages are cancelled; the pending query starts)
 *   idle     --sendStarted---------------> sending  (also clears an earlier error)
 *   sending  --sendSucceeded-------------> sent
 *   sending  --sendFailed(message)-------> idle     (with `error` set)
 *   any      --alertsChanged(alert)------> same, but `sawAlert` is latched
 *   any      --alertsChanged(none, loaded)> done    (only after an alert was seen; `done` latches)
 *
 * Nothing about alerts is decided before the pending query has answered: `loaded` is false while
 * the query is skipped (before `clearedOldPages`) or still loading.
 *
 * Known limitation (flagged by the audit, kept on purpose): `done` latches for ANY alert for this
 * client that was on screen and then left pending, not only the test page. A real alert arriving
 * and being answered during onboarding therefore also finishes this step. Fixing it is a behaviour
 * change for the owner to decide, not part of this refactor.
 */
import { defineMachine } from "@puck/shared";

export type TestSend = "idle" | "sending" | "sent";

export interface TestPageState {
  /** Old test pages are cancelled, so the pending query may run. */
  cleared: boolean;
  send: TestSend;
  /** The last send failure, shown until the next send starts. */
  error: string | null;
  /** An alert has been on screen since the step opened (or since the last time `done` latched). */
  sawAlert: boolean;
  /** An alert that was on screen has left pending. Latches. */
  done: boolean;
}

export type TestPageEvent =
  | { type: "clearedOldPages" }
  | { type: "sendStarted" }
  | { type: "sendSucceeded" }
  | { type: "sendFailed"; message: string }
  /** `hasAlert`: the first pending alert exists. `loaded`: the pending query has answered. */
  | { type: "alertsChanged"; hasAlert: boolean; loaded: boolean };

export function transitionTestPage(state: TestPageState, event: TestPageEvent): TestPageState {
  switch (event.type) {
    case "clearedOldPages":
      return state.cleared ? state : { ...state, cleared: true };
    case "sendStarted":
      return { ...state, send: "sending", error: null };
    case "sendSucceeded":
      return { ...state, send: "sent" };
    case "sendFailed":
      return { ...state, send: "idle", error: event.message };
    case "alertsChanged":
      if (event.hasAlert) return state.sawAlert ? state : { ...state, sawAlert: true };
      if (event.loaded && state.sawAlert && !state.done) return { ...state, sawAlert: false, done: true };
      return state;
  }
}

export const testPage = defineMachine<TestPageState, TestPageEvent>({
  name: "test-page",
  summary:
    "O3 test page: sending the urgent test alert, its error, and when the step is done (an alert that was on screen has left pending).",
  usedBy: ["app/src/screens/O3TestPage.tsx"],
  initial: { cleared: false, send: "idle", error: null, sawAlert: false, done: false },
  transition: transitionTestPage,
  label: (state) => {
    if (state.done) return "done";
    if (!state.cleared) return "clearing";
    if (state.send === "sending") return "sending";
    if (state.sawAlert) return "alertShown";
    return state.send === "sent" ? "sent" : "idle";
  },
  invariant: (state) => (state.send === "sending" && state.error !== null ? "sending with an error showing" : null),
  samples: {
    states: [
      { cleared: false, send: "idle", error: null, sawAlert: false, done: false },
      { cleared: true, send: "idle", error: null, sawAlert: false, done: false },
      { cleared: true, send: "idle", error: "offline", sawAlert: false, done: false },
      { cleared: true, send: "sending", error: null, sawAlert: false, done: false },
      { cleared: true, send: "sent", error: null, sawAlert: false, done: false },
      { cleared: true, send: "sent", error: null, sawAlert: true, done: false },
      { cleared: true, send: "sent", error: null, sawAlert: false, done: true },
    ],
    events: [
      { type: "clearedOldPages" },
      { type: "sendStarted" },
      { type: "sendSucceeded" },
      { type: "sendFailed", message: "offline" },
      { type: "alertsChanged", hasAlert: true, loaded: true },
      { type: "alertsChanged", hasAlert: false, loaded: true },
      { type: "alertsChanged", hasAlert: false, loaded: false },
    ],
  },
});
