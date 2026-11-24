/**
 * How this phone talks to Convex: the Clerk `convex` token on the socket, and this install's
 * `clients` row.
 *
 * - `useClientSession` is the one hook the app gate reads. It sets the Clerk token on the Convex
 *   client once the person is signed in, then registers the phone silently as a client under its
 *   model name (a same-name client asks "Replace?", Q11).
 * - `createClerkTokenFetcher` mints a fresh Clerk token each time Convex asks (they are short
 *   lived) from the account the app stores. Tokens are secrets and are never logged.
 *
 * The old device-JWT path (`session.ts`, `deviceStore.ts`) is not used here; the dev menu keeps
 * the setup-code screen that still reaches it.
 */
import { ClerkTokenError, fetchConvexToken, type ClerkAccount } from "@puck/shared";
import {
  clientApi,
  ensureClientRegistered,
  registerAnotherName,
  replaceClient,
  type RegistrationDeps,
  type RegistrationOutcome,
} from "@puck/client";
import { useConvex, type ConvexReactClient } from "convex/react";
import * as Device from "expo-device";
import { canUseFullScreenIntent } from "puck-full-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClerkView } from "./clerkAccount";
import { clerkHost, readStoredAccount } from "./clerkAccount";
import { clearClientId, readClientId, saveClientId } from "./clientStore";
import { readableError, jwtExpiresAtMs } from "./session";
import { loadNotificationsModule, readNotificationPermission, registerPushTokenWithConvex } from "./onboarding/notificationSetup";

/** Used when the phone reports no model name. */
export const FALLBACK_CLIENT_NAME = "Android phone";
/** A cached Clerk token is reused until it has this long left. */
const TOKEN_REUSE_MARGIN_MS = 15_000;

export function thisPhoneName(): string {
  return Device.modelName?.trim() || FALLBACK_CLIENT_NAME;
}

/** What the person is told when the Clerk token cannot be fetched. */
export function tokenProblemMessage(error: unknown): string {
  if (error instanceof ClerkTokenError) {
    switch (error.code) {
      case "template-missing":
        return 'Puck cannot sign in yet: the Clerk "convex" token template is missing. Add it in the Clerk dashboard, then try again.';
      case "unreachable":
        return "Puck could not reach the sign-in service. Check the connection and try again.";
      case "signed-out":
        return "Your sign-in has ended. Sign in again.";
      default:
        return "Sign-in was refused. Try again.";
    }
  }
  return "Could not sign in to Puck. Try again.";
}

type TokenFetcher = (args: { forceRefreshToken: boolean }) => Promise<string | null>;

/** The app has set the Clerk token on the Convex client (`useClientSession`). */
let appAuthSet = false;
let backgroundAuthSet = false;

/**
 * Signs the Convex client in from the stored account when the app has not: a card answer or the
 * card's answers fetched while Puck runs without its screens (a push woke it). The app's own
 * `setAuth` replaces this one when it starts. Does nothing when signed out (no stored account):
 * calls then wait, as before.
 */
export function ensureBackgroundAuth(client: Pick<ConvexReactClient, "setAuth">): void {
  if (appAuthSet || backgroundAuthSet) return;
  backgroundAuthSet = true;
  client.setAuth(createClerkTokenFetcher({ getAccount: readStoredAccount }));
}

/**
 * Convex calls this whenever it needs a token (first connect, expiry, a server rejection).
 * It returns null when signed out or when Clerk fails; `onProblem` gets the failure so the app
 * can say why. A token is reused until it nears expiry unless Convex forces a refresh.
 */
export function createClerkTokenFetcher(options: {
  getAccount: () => Promise<ClerkAccount | null>;
  onProblem?: (error: unknown) => void;
  fetchToken?: typeof fetchConvexToken;
  now?: () => number;
}): TokenFetcher {
  const fetchToken = options.fetchToken ?? fetchConvexToken;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string | null> | null = null;

  async function mint(): Promise<string | null> {
    const account = await options.getAccount();
    if (!account) {
      cached = null;
      return null;
    }
    try {
      const token = await fetchToken({ frontendApi: clerkHost, account });
      cached = { token, expiresAt: jwtExpiresAtMs(token) ?? now() + 30_000 };
      return token;
    } catch (error) {
      cached = null;
      options.onProblem?.(error);
      return null;
    }
  }

  return ({ forceRefreshToken }) => {
    if (!forceRefreshToken && cached && cached.expiresAt - now() > TOKEN_REUSE_MARGIN_MS) {
      return Promise.resolve(cached.token);
    }
    if (pending) return pending;
    pending = mint().finally(() => {
      pending = null;
    });
    return pending;
  };
}

/**
 * Saves this phone's push token on its client row. Only when notifications are already allowed,
 * so it never raises a permission prompt on its own. Best effort.
 */
export async function syncClientPushToken(client: ConvexReactClient, clientId: string): Promise<void> {
  if ((await readNotificationPermission()) !== "granted") return;
  const Notifications = await loadNotificationsModule();
  if (!Notifications) return;
  await registerPushTokenWithConvex(Notifications, async (token) => {
    await client.mutation(clientApi.clients.setPushToken, { clientId, token });
  });
}

/**
 * Saves whether this phone may cover the lock screen on its client row. Without it the backend
 * sends an urgent alert as a plain notification (no ring). Best effort.
 */
export async function syncClientFullScreen(client: ConvexReactClient, clientId: string): Promise<void> {
  await client.mutation(clientApi.clients.setFlags, { clientId, fullScreenAllowed: canUseFullScreenIntent() });
}

/* ---------- the hook ---------- */

export type ClientSession =
  /** Not signed in, or the token and registration are still being sorted out. */
  | { status: "pending" }
  | { status: "ready"; clientId: string }
  /** A client with this phone's name already exists (Q11). */
  | { status: "conflict"; name: string; busy: boolean; replace: () => void; useAnotherName: () => void }
  | { status: "error"; message: string; retry: () => void };

type Registration =
  | { kind: "waiting" }
  | { kind: "ready"; clientId: string }
  | { kind: "conflict"; name: string; busy: boolean }
  | { kind: "error"; message: string };

/**
 * Sets the Clerk token on the Convex client while signed in, then registers this phone.
 * The Clerk account is read from the app's secure store each time Convex asks for a token;
 * `signOut` is called if Clerk says the session is gone.
 */
export function useClientSession(options: {
  clerkStatus: ClerkView;
  signOut: () => Promise<void>;
}): ClientSession {
  const client = useConvex();
  const [auth, setAuthState] = useState<"pending" | "in" | "out">("pending");
  const [authProblem, setAuthProblem] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [registration, setRegistration] = useState<Registration>({ kind: "waiting" });
  const [registrationAttempt, setRegistrationAttempt] = useState(0);
  const signOutRef = useRef(options.signOut);
  signOutRef.current = options.signOut;
  const hasAuth = useRef(false);

  const deps = useCallback(
    (): RegistrationDeps => ({
      platform: "android",
      readClientId,
      saveClientId,
      clearClientId,
      listClients: () => client.query(clientApi.clients.list, {}),
      register: (args) => client.mutation(clientApi.clients.register, args),
      touch: (clientId) => client.mutation(clientApi.clients.touch, { clientId }),
    }),
    [client],
  );

  // The Clerk token on the socket.
  useEffect(() => {
    if (options.clerkStatus !== "in") {
      if (hasAuth.current) {
        client.clearAuth();
        hasAuth.current = false;
        appAuthSet = false;
      }
      setAuthState("pending");
      setAuthProblem(null);
      return;
    }
    let live = true;
    setAuthState("pending");
    setAuthProblem(null);
    hasAuth.current = true;
    appAuthSet = true;
    client.setAuth(
      createClerkTokenFetcher({
        getAccount: readStoredAccount,
        onProblem: (error) => {
          if (!live) return;
          setAuthProblem(tokenProblemMessage(error));
          if (error instanceof ClerkTokenError && error.code === "signed-out") void signOutRef.current();
        },
      }),
      (authenticated) => {
        if (live) setAuthState(authenticated ? "in" : "out");
      },
    );
    return () => {
      live = false;
    };
  }, [client, options.clerkStatus, authAttempt]);

  // This phone's client row, once the token is accepted. A brief token failure later on (the
  // phone went offline when Convex asked for a fresh token) does not undo a finished registration.
  useEffect(() => {
    if (auth === "pending") {
      setRegistration({ kind: "waiting" });
      return;
    }
    if (auth === "out") return;
    let live = true;
    setRegistration((previous) => (previous.kind === "ready" ? previous : { kind: "waiting" }));
    ensureClientRegistered(deps(), thisPhoneName())
      .then((outcome) => {
        if (live) setRegistration(outcome.kind === "ready" ? outcome : { ...outcome, busy: false });
      })
      .catch((error: unknown) => {
        if (live) setRegistration({ kind: "error", message: readableError(error) });
      });
    return () => {
      live = false;
    };
  }, [auth, deps, registrationAttempt]);

  const resolve = useCallback(
    (name: string, run: (deps: RegistrationDeps, name: string) => Promise<RegistrationOutcome>) => {
      setRegistration({ kind: "conflict", name, busy: true });
      run(deps(), name)
        .then((outcome) => setRegistration(outcome.kind === "ready" ? outcome : { ...outcome, busy: false }))
        .catch((error: unknown) => setRegistration({ kind: "error", message: readableError(error) }));
    },
    [deps],
  );

  if (options.clerkStatus !== "in") return { status: "pending" };
  if (auth === "out" && registration.kind !== "ready") {
    return {
      status: "error",
      message: authProblem ?? "Could not sign in to Puck. Try again.",
      retry: () => setAuthAttempt((n) => n + 1),
    };
  }
  switch (registration.kind) {
    case "ready":
      return { status: "ready", clientId: registration.clientId };
    case "conflict":
      return {
        status: "conflict",
        name: registration.name,
        busy: registration.busy,
        replace: () => resolve(registration.name, replaceClient),
        useAnotherName: () => resolve(registration.name, registerAnotherName),
      };
    case "error":
      return { status: "error", message: registration.message, retry: () => setRegistrationAttempt((n) => n + 1) };
    default:
      return { status: "pending" };
  }
}
