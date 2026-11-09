/** Every state machine that lives in `@puck/shared`. See machine.ts for the convention. */
import { alertLifecycle } from "./alertLifecycle";
import type { Machine } from "./machine";

// biome-ignore lint/suspicious/noExplicitAny: a registry holds machines of different state types.
export const sharedMachines: readonly Machine<any, any>[] = [alertLifecycle];
