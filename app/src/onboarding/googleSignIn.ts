import { ClerkSignInError, signInWithGoogleOneTap, type ClerkAccount } from "@puck/shared";
import { useState } from "react";
import { clerkHost } from "../clerkAccount";
import { NativeGoogleSignInError, requestGoogleIdToken } from "./nativeGoogleSignIn";

export function useGoogleSignIn(onSignedIn: (account: ClerkAccount) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await requestGoogleIdToken();
      const account = await signInWithGoogleOneTap({ frontendApi: clerkHost, idToken });
      await onSignedIn(account);
    } catch (caught) {
      if (caught instanceof NativeGoogleSignInError && caught.kind === "cancelled") return;
      if (caught instanceof ClerkSignInError) {
        setError(caught.message);
        return;
      }
      if (caught instanceof NativeGoogleSignInError) {
        setError(caught.message);
        return;
      }
      setError("could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, start };
}
