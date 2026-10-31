import { ConvexProvider, useConvex } from "convex/react";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { appGate, type GateStatus, type OnboardingStatus } from "./src/accountGate";
import { useClerkAccount } from "./src/clerkAccount";
import { PuckFontGate } from "./src/components/PuckFontGate";
import { PuckBody, PuckKicker, PuckTitle } from "./src/components/PuckButton";
import { PuckScreen } from "./src/components/PuckScreen";
import { convex } from "./src/client";
import { convexSiteUrl } from "./src/deployment";
import { readDeviceSecret } from "./src/deviceStore";
import { Inbox } from "./src/Inbox";
import { OnboardingFlow } from "./src/onboarding/OnboardingFlow";
import { readOnboardingComplete } from "./src/onboarding/onboardingStore";
import { readDevWalkthrough, startDevWalkthrough } from "./src/onboarding/devOnboarding";
import { usePushRegistration } from "./src/push";
import { deviceTokenFetcher, readableError } from "./src/session";

type SecretState = string | null | undefined;

export default function App() {
  return (
    <PuckFontGate>
      <AppBody />
    </PuckFontGate>
  );
}

function AppBody() {
  const clerk = useClerkAccount();
  const [secret, setSecret] = useState<SecretState>(undefined);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [devWalkthrough, setDevWalkthrough] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readDeviceSecret()
      .then((stored) => {
        if (!cancelled) setSecret(stored);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSecret(null);
        console.error(readableError(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readOnboardingComplete()
      .then((done) => {
        if (!cancelled) setOnboardingDone(done);
      })
      .catch(() => {
        if (!cancelled) setOnboardingDone(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    let cancelled = false;
    readDevWalkthrough()
      .then((active) => {
        if (!cancelled) setDevWalkthrough(active);
      })
      .catch(() => {
        if (!cancelled) setDevWalkthrough(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onboardingStatus: OnboardingStatus =
    devWalkthrough && __DEV__
      ? "incomplete"
      : onboardingDone === null
        ? "unknown"
        : onboardingDone
          ? "complete"
          : "incomplete";
  const deviceStatus = deviceGateStatus(secret);
  const gate = appGate(clerk.status, deviceStatus, onboardingStatus);

  async function replayDevOnboarding() {
    if (!__DEV__) return;
    await startDevWalkthrough();
    setDevWalkthrough(true);
    setOnboardingDone(false);
  }

  if (gate === "opening") {
    return (
      <PuckScreen center>
        <PuckKicker>Puck</PuckKicker>
        <PuckTitle>Opening…</PuckTitle>
        <StatusBar style="dark" />
      </PuckScreen>
    );
  }

  if (gate === "onboarding") {
    return (
      <>
        <OnboardingFlow
          clerkStatus={clerk.status}
          deviceStatus={deviceStatus}
          email={clerk.email}
          devWalkthrough={devWalkthrough}
          onAcceptAccount={clerk.accept}
          onDeviceClaimed={(next) => setSecret(next)}
          onSignOut={() => void clerk.signOut()}
          onFinished={() => setOnboardingDone(true)}
          onDevWalkthroughChange={setDevWalkthrough}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  if (!secret) {
    return (
      <PuckScreen center>
        <PuckTitle>Missing device secret</PuckTitle>
        <PuckBody>Sign out and run through setup again.</PuckBody>
        <StatusBar style="dark" />
      </PuckScreen>
    );
  }

  return (
    <ConvexProvider client={convex}>
      <SignedIn
        secret={secret}
        email={clerk.email}
        onSignOut={() => void clerk.signOut()}
        onDevReplayOnboarding={() => void replayDevOnboarding()}
      />
    </ConvexProvider>
  );
}

function deviceGateStatus(secret: SecretState): GateStatus {
  if (secret === undefined) return "unknown";
  return secret ? "in" : "out";
}

function SignedIn({
  secret,
  email,
  onSignOut,
  onDevReplayOnboarding,
}: {
  secret: string;
  email: string | null;
  onSignOut: () => void;
  onDevReplayOnboarding: () => void;
}) {
  const client = useConvex();
  const [auth, setAuth] = useState<"pending" | "in" | "out">("pending");
  const notifications = usePushRegistration(auth === "in");

  useEffect(() => {
    client.setAuth(deviceTokenFetcher(convexSiteUrl, secret), (isAuthenticated) => {
      setAuth(isAuthenticated ? "in" : "out");
    });
  }, [client, secret]);

  if (auth === "pending") {
    return (
      <PuckScreen center>
        <PuckKicker>Puck</PuckKicker>
        <PuckTitle>Signing in…</PuckTitle>
        <StatusBar style="dark" />
      </PuckScreen>
    );
  }

  if (auth === "out") {
    return (
      <PuckScreen center>
        <PuckKicker>Puck</PuckKicker>
        <PuckTitle>This phone</PuckTitle>
        <PuckBody>The saved device secret was rejected. Sign out and connect this phone again.</PuckBody>
        <StatusBar style="dark" />
      </PuckScreen>
    );
  }

  return (
    <>
      <Inbox
        notifications={notifications}
        email={email}
        onSignOut={onSignOut}
        onDevReplayOnboarding={onDevReplayOnboarding}
      />
      <StatusBar style="dark" />
    </>
  );
}

const styles = StyleSheet.create({});
