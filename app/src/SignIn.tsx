import { ClerkSignInError, beginGoogleSignIn, callbackProblem, finishGoogleSignIn, nonceFromCallback } from "@puck/shared";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { clearPendingSignIn, clerkHost, readPendingSignIn, savePendingSignIn } from "./clerkAccount";

const REDIRECT_URL = "puck://sso-callback";

export function SignInScreen({ onSignedIn }: { onSignedIn: (account: Awaited<ReturnType<typeof finishGoogleSignIn>>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishing = useRef(false);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    const subscription = Linking.addEventListener("url", (event) => {
      void complete(event.url);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) void complete(url);
    });
    return () => subscription.remove();
  }, []);

  async function complete(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "puck:" || parsed.hostname !== "sso-callback" || finishing.current) return;
    const problem = callbackProblem(url);
    if (problem) {
      setError(problem);
      return;
    }
    const pending = await readPendingSignIn();
    if (!pending) return;
    finishing.current = true;
    setBusy(true);
    setError(null);
    try {
      const account = await finishGoogleSignIn({
        frontendApi: clerkHost,
        clientJwt: pending.clientJwt,
        signInId: pending.signInId,
        rotatingTokenNonce: nonceFromCallback(url) ?? "",
        callbackUrl: url,
        devBrowser: pending.devBrowser,
      });
      await clearPendingSignIn();
      await onSignedInRef.current(account);
    } catch (caught) {
      finishing.current = false;
      setError(caught instanceof ClerkSignInError ? caught.message : "could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const attempt = await beginGoogleSignIn({ frontendApi: clerkHost, redirectUrl: REDIRECT_URL });
      await savePendingSignIn(attempt);
      await Linking.openURL(attempt.verificationUrl);
    } catch (caught) {
      setError(caught instanceof ClerkSignInError ? caught.message : "could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>Puck</Text>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.body}>Continue with the Google account that should receive alerts on this phone.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={() => void start()}
        disabled={busy}
        style={({ pressed }) => [styles.button, pressed || busy ? styles.buttonPressed : null]}
      >
        <Text style={styles.buttonText}>{busy ? "Opening Google…" : "Continue with Google"}</Text>
      </Pressable>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3e6dc",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  kicker: {
    color: "#8a4524",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  title: {
    color: "#3c241c",
    fontSize: 36,
    fontWeight: "700",
    marginBottom: 8,
  },
  body: {
    color: "#3c241c",
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 20,
  },
  error: {
    color: "#8a2f24",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2a1814",
    borderRadius: 14,
    paddingVertical: 16,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff9f5",
    fontSize: 17,
    fontWeight: "700",
  },
});
