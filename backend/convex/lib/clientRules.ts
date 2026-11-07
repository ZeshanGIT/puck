// Pure rules for `clients`: name validation, the register decision, the cap.
// No Convex imports, so `bun test` can run them.

export const CLIENT_PLATFORMS = ["android", "cli"] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export const CLIENT_NAME_MAX = 40;
export const MAX_CLIENTS_PER_USER = 10;

export const UNAUTHORIZED = "unauthorized";
export const CLIENT_NOT_FOUND = "client not found";
export const CLIENT_NAME_INVALID = `name must be 1 to ${CLIENT_NAME_MAX} characters on one line`;
export const CLIENT_NAME_TAKEN = "a client with that name already exists";
export const TOO_MANY_CLIENTS = "too many clients";

// Any control character (this covers \n and \r) and the Unicode line and paragraph separators.
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

/** The trimmed name, or null when it is empty, too long, or not on one line. */
export function validateClientName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || [...name].length > CLIENT_NAME_MAX) return null;
  if (NOT_ONE_LINE.test(name)) return null;
  return name;
}

export type RegisterDecision =
  | { action: "exists"; clientId: string }
  | { action: "replace"; clientId: string }
  | { action: "create" }
  | { action: "full" };

/**
 * What `clients.register` does. `sameName` is the user's existing client with that name, if any.
 * `exists` changes nothing: the app asks "Replace Pixel 7?" and calls again with `replace`.
 * Replacing never grows the list, so the cap only applies to a new row.
 */
export function decideRegistration(input: {
  sameName: { id: string } | null;
  replace: boolean;
  clientCount: number;
}): RegisterDecision {
  if (input.sameName) {
    return input.replace
      ? { action: "replace", clientId: input.sameName.id }
      : { action: "exists", clientId: input.sameName.id };
  }
  return input.clientCount >= MAX_CLIENTS_PER_USER ? { action: "full" } : { action: "create" };
}

/** One client as `clients.list` returns it. The push token itself never leaves the server: only whether there is one. */
export interface ClientView {
  id: string;
  name: string;
  platform: ClientPlatform;
  fullScreenAllowed?: boolean;
  dndAccess?: boolean;
  hasPushToken: boolean;
  lastSeenAt: number;
  createdAt: number;
}

export function toClientView(row: {
  _id: string;
  name: string;
  platform: ClientPlatform;
  pushToken?: string;
  fullScreenAllowed?: boolean;
  dndAccess?: boolean;
  lastSeenAt: number;
  createdAt: number;
}): ClientView {
  return {
    id: row._id,
    name: row.name,
    platform: row.platform,
    ...(row.fullScreenAllowed === undefined ? {} : { fullScreenAllowed: row.fullScreenAllowed }),
    ...(row.dndAccess === undefined ? {} : { dndAccess: row.dndAccess }),
    hasPushToken: typeof row.pushToken === "string" && row.pushToken.length > 0,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

/** A rename clashes when another client of the same user already has the name. */
export function renameConflicts(clientId: string, sameName: { id: string } | null): boolean {
  return sameName !== null && sameName.id !== clientId;
}

type IdentityView = { subject?: string | null; issuer?: string | null } | null;

function trimSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

/**
 * The Clerk user id behind a Convex identity. The device JWT is signed by this deployment,
 * so it has a different issuer; only a token from the Clerk issuer counts as a user.
 */
export function clerkSubject(identity: IdentityView, clerkIssuer: string): string {
  if (!identity?.subject) throw new Error(UNAUTHORIZED);
  if (trimSlashes(identity.issuer ?? "") !== trimSlashes(clerkIssuer)) throw new Error(UNAUTHORIZED);
  return identity.subject;
}
