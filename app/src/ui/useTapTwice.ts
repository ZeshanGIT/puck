/**
 * Tap twice: the first tap arms a control, a second tap on the same control
 * within `ARM_MS` fires it, and the window running out disarms it. Arming
 * another control that shares the group disarms the first. Ported from the
 * prototype's `armTimer()` and `disarm()` in
 * `vault/Projects/Puck/mockups/Puck prototype.html`.
 *
 * Layers, so the logic can be tested without React or real timers:
 * - `armReducer`: pure state machine, the clock is passed in.
 * - `createArmStore`: holds the state, one expiry timer, and subscribers; the
 *   clock and timers are injectable.
 * - `useTapTwice`: React hook over a store (private, or the surrounding
 *   `TapTwiceGroup`'s shared one) plus haptics.
 */
import {
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** How long a control stays armed (prototype `ARM_MS`). */
export const ARM_MS = 4000;

// ---------------------------------------------------------------- state machine

export interface ArmState {
  /** The control that is armed, or null. */
  readonly armedId: string | null;
  /** Clock time (ms) when it was armed; 0 when nothing is armed. */
  readonly armedAt: number;
}

export const IDLE_ARM: ArmState = { armedId: null, armedAt: 0 };

export type ArmAction =
  | { type: "press"; id: string; now: number }
  | { type: "disarm"; id?: string };

/** What a press did: armed the control, fired it, or nothing (a disarm). */
export type ArmEffect = "arm" | "fire" | "none";

export function armReducer(
  state: ArmState,
  action: ArmAction,
): { state: ArmState; effect: ArmEffect } {
  if (action.type === "disarm") {
    if (state.armedId === null) return { state, effect: "none" };
    if (action.id !== undefined && action.id !== state.armedId) return { state, effect: "none" };
    return { state: IDLE_ARM, effect: "none" };
  }
  const windowOpen = state.armedId !== null && action.now - state.armedAt < ARM_MS;
  if (windowOpen && state.armedId === action.id) {
    return { state: IDLE_ARM, effect: "fire" };
  }
  // First tap, a tap after the window ran out, or a tap on a different control:
  // arm this one (which drops any other).
  return { state: { armedId: action.id, armedAt: action.now }, effect: "arm" };
}

// ------------------------------------------------------------------------ store

export interface ArmClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const realClock: ArmClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ArmStore {
  getState(): ArmState;
  subscribe(listener: () => void): () => void;
  /** Press the control `id`. Returns what happened. */
  press(id: string): ArmEffect;
  /** Disarm `id`, or whatever is armed when `id` is omitted. */
  disarm(id?: string): void;
}

export function createArmStore(clock: ArmClock = realClock): ArmStore {
  let state: ArmState = IDLE_ARM;
  let timer: unknown = null;
  const listeners = new Set<() => void>();

  function stopTimer() {
    if (timer !== null) {
      clock.clearTimer(timer);
      timer = null;
    }
  }

  function apply(next: ArmState) {
    if (next === state) return;
    const rearmed = next.armedId !== null && (next.armedId !== state.armedId || next.armedAt !== state.armedAt);
    state = next;
    if (next.armedId === null) {
      stopTimer();
    } else if (rearmed) {
      stopTimer();
      timer = clock.setTimer(() => {
        timer = null;
        apply(IDLE_ARM);
      }, ARM_MS);
    }
    listeners.forEach((l) => l());
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    press(id) {
      const result = armReducer(state, { type: "press", id, now: clock.now() });
      apply(result.state);
      return result.effect;
    },
    disarm(id) {
      apply(armReducer(state, { type: "disarm", id }).state);
    },
  };
}

// --------------------------------------------------------------------- haptics

type HapticsModule = typeof import("expo-haptics");

let hapticsModule: Promise<HapticsModule | null> | null = null;

/** Runs a haptic call. Never throws, never rejects, and does nothing where expo-haptics is unavailable. */
function haptic(call: (h: HapticsModule) => Promise<void>): void {
  try {
    hapticsModule ??= import("expo-haptics").catch(() => null);
    void hapticsModule.then((h) => (h ? call(h) : undefined)).catch(() => undefined);
  } catch {
    // Haptics are a nicety; swallow everything.
  }
}

/** The only three haptics in the app's tap-twice flow (guide, "Haptics"). */
export const haptics = {
  /** A light tick on arm. */
  tick: () => haptic((h) => h.impactAsync(h.ImpactFeedbackStyle.Light)),
  /** A firmer confirm on send. */
  confirm: () => haptic((h) => h.impactAsync(h.ImpactFeedbackStyle.Medium)),
  /** A double buzz on error. */
  error: () => haptic((h) => h.notificationAsync(h.NotificationFeedbackType.Error)),
};

// ------------------------------------------------------------------- React hook

const GroupContext = createContext<ArmStore | null>(null);

/** Controls inside share one arm slot: arming one disarms the others. */
export function TapTwiceGroup({ children }: { children: ReactNode }): ReactElement {
  const [store] = useState(() => createArmStore());
  return createElement(GroupContext.Provider, { value: store }, children);
}

export interface UseTapTwiceOptions {
  /** Called on the second tap. */
  onConfirm: () => void;
}

export interface TapTwice {
  armed: boolean;
  /** Clock time (ms, `Date.now()`) when this control was armed, or null. Feeds `ArmTimer`. */
  armedAt: number | null;
  /** First call arms, a second call within `ARM_MS` fires `onConfirm`. */
  press: () => void;
  disarm: () => void;
}

export function useTapTwice({ onConfirm }: UseTapTwiceOptions): TapTwice {
  const group = useContext(GroupContext);
  const own = useRef<ArmStore | null>(null);
  const store = group ?? (own.current ??= createArmStore());
  const id = useId();

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const armed = state.armedId === id;

  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;

  useEffect(() => () => store.disarm(id), [store, id]);

  const press = useCallback(() => {
    const effect = store.press(id);
    if (effect === "arm") {
      haptics.tick();
    } else if (effect === "fire") {
      haptics.confirm();
      confirm.current();
    }
  }, [store, id]);

  const disarm = useCallback(() => store.disarm(id), [store, id]);

  return { armed, armedAt: armed ? state.armedAt : null, press, disarm };
}
