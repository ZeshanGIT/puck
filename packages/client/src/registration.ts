import type { ClientCatalogItem, ClientRegistration, ClientRegistrationResult } from "./index";

/** Maximum client name length enforced by the registration endpoint. */
export const CLIENT_NAME_MAX = 40;

/** The Convex calls and the stored client id that registration needs; injected so it stays testable. */
export interface RegistrationDeps {
  platform: ClientRegistration["platform"];
  readClientId: () => Promise<string | null>;
  saveClientId: (id: string) => Promise<void>;
  clearClientId: () => Promise<void>;
  listClients: () => Promise<ReadonlyArray<Pick<ClientCatalogItem, "id">>>;
  register: (args: ClientRegistration) => Promise<ClientRegistrationResult>;
  touch: (clientId: string) => Promise<unknown>;
}

export type RegistrationOutcome =
  | { kind: "ready"; clientId: string }
  | { kind: "conflict"; name: string };

/**
 * After sign-in: if this install already has a client row on the account, use it. Otherwise
 * register under `name`. A same-name client that is not ours is reported as a `conflict`
 * (the app asks "Replace?") and nothing changes.
 */
export async function ensureClientRegistered(deps: RegistrationDeps, name: string): Promise<RegistrationOutcome> {
  const stored = await deps.readClientId();
  if (stored) {
    const clients = await deps.listClients();
    if (clients.some((client) => client.id === stored)) {
      await deps.touch(stored).catch(() => {});
      return { kind: "ready", clientId: stored };
    }
    // The row is gone, or it belongs to another account.
    await deps.clearClientId();
  }
  const result = await deps.register({ name, platform: deps.platform });
  if (result.status === "exists") return { kind: "conflict", name };
  await deps.saveClientId(result.clientId);
  return { kind: "ready", clientId: result.clientId };
}

/** Replace the same-name client (its push token is cleared) and keep its row id. */
export async function replaceClient(deps: RegistrationDeps, name: string): Promise<RegistrationOutcome> {
  const result = await deps.register({ name, platform: deps.platform, replace: true });
  await deps.saveClientId(result.clientId);
  return { kind: "ready", clientId: result.clientId };
}

/** "Pixel 7 (2)", "Pixel 7 (3)" and so on, whichever is free. */
function alternativeName(name: string, n: number): string {
  const suffix = ` (${n})`;
  return `${[...name].slice(0, CLIENT_NAME_MAX - suffix.length).join("").trimEnd()}${suffix}`;
}

export async function registerAnotherName(deps: RegistrationDeps, name: string): Promise<RegistrationOutcome> {
  for (let n = 2; n <= 9; n += 1) {
    const result = await deps.register({ name: alternativeName(name, n), platform: deps.platform });
    if (result.status === "created") {
      await deps.saveClientId(result.clientId);
      return { kind: "ready", clientId: result.clientId };
    }
  }
  throw new Error("Too many clients share this name. Remove an old one and try again.");
}
