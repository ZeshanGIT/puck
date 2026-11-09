/**
 * The Puck state machine convention.
 *
 * A flow with more than one moving part (a lifecycle, a multi-step screen, a permission check) is
 * written as ONE pure `transition(state, event) => state` and ONE state type, in a `*Machine.ts`
 * file with no React and no I/O. Components and mutations only translate what happened into an
 * event, call the transition, and render or persist the result. Side effects a transition wants
 * (toasts, writes, timers) are returned as data in the state, never done inside it.
 *
 * `defineMachine` gives every machine the same shape, so that:
 * - tests get a totality check for free (`checkMachine`: every sample state meets every sample
 *   event, nothing throws, nothing mutates its input, the same input gives the same output, and the
 *   machine's own invariant holds);
 * - agents and humans get a generated diagram and table (`describeMachine`, rendered into
 *   `docs/state-machines.md` by `bun run machines:doc`);
 * - the rules live in one file instead of in effect order.
 *
 * Add new machines to the registry (`machines.ts` in the package that owns them) and keep the
 * samples honest: list one state per control state and at least one event of every type.
 */

export interface MachineSpec<S, E extends { type: string }> {
  /** Stable name, such as `alert-lifecycle`. Used in docs and test names. */
  readonly name: string;
  /** One or two sentences: what this machine governs and who owns the result. */
  readonly summary: string;
  /** Where the machine is used, as repo-relative paths. Docs only. */
  readonly usedBy: readonly string[];
  readonly initial: S;
  /** Pure and total: an event that makes no sense in a state returns the state unchanged. */
  readonly transition: (state: S, event: E) => S;
  /** A short label for a state's control phase, such as `waiting`. Used for the diagram. */
  readonly label: (state: S) => string;
  /** Returns a message when the state is impossible, or null. Checked after every transition. */
  readonly invariant?: (state: S) => string | null;
  /** Representative states (one per control phase) and events (one per type) for the checks. */
  readonly samples: { readonly states: readonly S[]; readonly events: readonly E[] };
}

export type Machine<S, E extends { type: string }> = MachineSpec<S, E>;

/** Type-checks a machine definition and returns it. */
export function defineMachine<S, E extends { type: string }>(spec: MachineSpec<S, E>): Machine<S, E> {
  return spec;
}

/** Runs a machine over a list of events from its initial state and returns every state reached. */
export function runMachine<S, E extends { type: string }>(
  machine: Pick<Machine<S, E>, "initial" | "transition">,
  events: readonly E[],
  from?: S,
): S[] {
  const states: S[] = [];
  let state = from ?? machine.initial;
  for (const event of events) {
    state = machine.transition(state, event);
    states.push(state);
  }
  return states;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Totality and purity check. Returns a list of problems; an empty list means the machine passes.
 * States and events must be JSON-serializable (no functions, no Date): the check clones and freezes
 * them so a transition that mutates its input throws and is reported.
 */
export function checkMachine<S, E extends { type: string }>(machine: Machine<S, E>): string[] {
  const problems: string[] = [];
  const states = [machine.initial, ...machine.samples.states];
  const check = (where: string, state: S) => {
    const message = machine.invariant?.(state);
    if (message) problems.push(`${where}: invariant broken: ${message}`);
  };
  for (const state of states) check(`${machine.name} sample state ${machine.label(state)}`, state);
  for (const state of states) {
    for (const event of machine.samples.events) {
      const where = `${machine.name}: ${machine.label(state)} + ${event.type}`;
      let first: S;
      let second: S;
      try {
        first = machine.transition(deepFreeze(clone(state)), deepFreeze(clone(event)));
        second = machine.transition(deepFreeze(clone(state)), deepFreeze(clone(event)));
      } catch (error) {
        problems.push(`${where}: threw (or mutated its input): ${String(error)}`);
        continue;
      }
      if (JSON.stringify(first) !== JSON.stringify(second)) problems.push(`${where}: not deterministic`);
      check(where, first);
    }
  }
  return problems;
}

export interface MachineTransitionRow {
  from: string;
  event: string;
  to: string;
}

/**
 * The transition table at the level of labels, for docs: every (from label, event type) pair that
 * changes the label, across the sample states and events. Self-transitions are left out.
 */
export function describeMachine<S, E extends { type: string }>(machine: Machine<S, E>): MachineTransitionRow[] {
  const rows = new Map<string, MachineTransitionRow>();
  for (const state of [machine.initial, ...machine.samples.states]) {
    for (const event of machine.samples.events) {
      let next: S;
      try {
        next = machine.transition(clone(state), clone(event));
      } catch {
        continue;
      }
      const from = machine.label(state);
      const to = machine.label(next);
      if (from === to) continue;
      rows.set(`${from}|${event.type}|${to}`, { from, event: event.type, to });
    }
  }
  return [...rows.values()];
}

/** Renders a machine as a Mermaid `stateDiagram-v2` block body. */
export function mermaidFor<S, E extends { type: string }>(machine: Machine<S, E>): string {
  const lines = ["stateDiagram-v2", `  [*] --> ${safeId(machine.label(machine.initial))}`];
  for (const row of describeMachine(machine)) {
    lines.push(`  ${safeId(row.from)} --> ${safeId(row.to)}: ${row.event}`);
  }
  return lines.join("\n");
}

function safeId(label: string): string {
  return label.replace(/[^A-Za-z0-9_]/gu, "_");
}
