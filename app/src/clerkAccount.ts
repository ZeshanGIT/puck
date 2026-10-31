import {
  ClerkSignInError,
  clerkFrontendApi,
  endClerkSession,
  readClerkAccount,
  type ClerkAccount,
  type GoogleSignInAttempt,
} from "@puck/shared";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

const ACCOUNT_KEY = "puck.clerkAccount";
const PENDING_KEY = "puck.clerkPending";

export const clerkHost = clerkFrontendApi(process.env.EXPO_PUBLIC_CLERK_FRONTEND_API);

export type ClerkView = "unknown" | "out" | "in";

export function useClerkAccount(): {
  status: ClerkView;
  email: string | null;
  accept: (account: ClerkAccount) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const [status, setStatus] = useState<ClerkView>("unknown");
  const [account, setAccount] = useState<ClerkAccount | null>(null);

  useEffect(() => {
    let cancelled = false;
    readStoredAccount()
      .then(async (stored) => {
        if (cancelled) return;
        if (!stored) {
          setStatus("out");
          return;
        }
        setAccount(stored);
        setStatus("in");
        try {
          const fresh = await readClerkAccount({
            frontendApi: clerkHost,
            clientJwt: stored.clientJwt,
            devBrowser: stored.devBrowser,
          });
          if (cancelled) return;
          await saveStoredAccount(fresh);
          setAccount(fresh);
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ClerkSignInError && error.code === "signed-out") {
            await clearStoredAccount();
            setAccount(null);
            setStatus("out");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    status,
    email: account?.email ?? null,
    accept: async (next) => {
      await saveStoredAccount(next);
      await clearPendingSignIn();
      setAccount(next);
      setStatus("in");
    },
    signOut: async () => {
      if (account) await endClerkSession({ frontendApi: clerkHost, account });
      await clearStoredAccount();
      await clearPendingSignIn();
      setAccount(null);
      setStatus("out");
    },
  };
}

export async function readPendingSignIn(): Promise<Pick<GoogleSignInAttempt, "clientJwt" | "signInId" | "devBrowser"> | null> {
  return readJson(PENDING_KEY, isPending);
}

export async function savePendingSignIn(
  attempt: Pick<GoogleSignInAttempt, "clientJwt" | "signInId" | "devBrowser">,
): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(attempt));
}

export async function clearPendingSignIn(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_KEY);
}

async function readStoredAccount(): Promise<ClerkAccount | null> {
  return readJson(ACCOUNT_KEY, isAccount);
}

async function saveStoredAccount(account: ClerkAccount): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account));
}

async function clearStoredAccount(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCOUNT_KEY);
}

async function readJson<T>(key: string, check: (value: unknown) => value is T): Promise<T | null> {
  const text = await SecureStore.getItemAsync(key);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return check(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPending(value: unknown): value is Pick<GoogleSignInAttempt, "clientJwt" | "signInId" | "devBrowser"> {
  if (!isRecord(value)) return false;
  const jwt = typeof value.clientJwt === "string" && value.clientJwt.startsWith("eyJ");
  const browser = typeof value.devBrowser === "string" && value.devBrowser.startsWith("dvb_");
  return (jwt || browser) && typeof value.signInId === "string" && value.signInId.startsWith("sia_");
}

function isAccount(value: unknown): value is ClerkAccount {
  if (!isRecord(value)) return false;
  const jwt = typeof value.clientJwt === "string" && value.clientJwt.startsWith("eyJ");
  const browser = typeof value.devBrowser === "string" && value.devBrowser.startsWith("dvb_");
  return (
    (jwt || browser) &&
    typeof value.sessionId === "string" &&
    value.sessionId.startsWith("sess_") &&
    typeof value.userId === "string" &&
    value.userId.startsWith("user_") &&
    typeof value.email === "string" &&
    value.email.includes("@")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
