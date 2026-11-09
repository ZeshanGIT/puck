/**
 * Every state machine in the app, in one list. Add a new `*Machine.ts` here: `machines.test.ts`
 * fails when a machine file is missing from this list or does not pass `checkMachine`, and
 * `bun run machines:doc` turns the list into `docs/state-machines.md`.
 */
import type { Machine } from "@puck/shared";
import { alertLaunch } from "./alertLaunchMachine";
import { appSession } from "./appSessionMachine";
import { pairingFlow } from "./pairingFlowMachine";
import { permissionsCheck } from "./permissionsMachine";
import { testPage } from "./testPageMachine";

// biome-ignore lint/suspicious/noExplicitAny: a registry holds machines of different state types.
export const appMachines: readonly Machine<any, any>[] = [appSession, alertLaunch, pairingFlow, permissionsCheck, testPage];
