import { defineMachine } from "@puck/shared";

interface State {
  pending: readonly string[];
  queue: readonly string[];
}

type Event =
  | { type: "snapshot"; pending: readonly string[]; eligible: readonly string[] }
  | { type: "dismiss"; questionId: string }
  | { type: "hide" }
  | { type: "reset" };

export const floatingCard = defineMachine<State, Event>({
  name: "floating-reply-card",
  summary: "Queue new alerts while the inbox is in the background. Keep the open reply in place and remove alerts as they leave the pending list.",
  usedBy: ["desktop/src/main/index.ts"],
  initial: { pending: [], queue: [] },
  label: ({ queue }) => queue.length ? "showing" : "hidden",
  transition: (state, event) => {
    switch (event.type) {
      case "snapshot": {
        const pending = new Set(event.pending);
        const previous = new Set(state.pending);
        const queue = state.queue.filter((id) => pending.has(id));
        for (const id of event.eligible) {
          if (pending.has(id) && !previous.has(id) && !queue.includes(id)) queue.push(id);
        }
        return { pending: event.pending, queue };
      }
      case "dismiss":
        return state.queue[0] === event.questionId
          ? { ...state, queue: state.queue.slice(1) }
          : state;
      case "hide":
        return { ...state, queue: [] };
      case "reset":
        return { pending: [], queue: [] };
    }
  },
  invariant: ({ pending, queue }) =>
    new Set(queue).size === queue.length && queue.every((id) => pending.includes(id))
      ? null : "The card queue must contain only distinct pending alerts.",
  samples: {
    states: [{ pending: ["first", "second"], queue: ["first", "second"] }],
    events: [
      { type: "snapshot", pending: ["second", "third"], eligible: ["third"] },
      { type: "dismiss", questionId: "first" },
      { type: "hide" },
      { type: "reset" },
    ],
  },
});
