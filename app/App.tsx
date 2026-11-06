import type { ClerkAccount } from "@puck/shared";
import { ConvexProvider } from "convex/react";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Linking, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { appGate, nextStep, type OnboardingStatus, type OnboardingStep } from "./src/accountGate";
import { useClerkAccount } from "./src/clerkAccount";
import { convex } from "./src/client";
import { useClientSession } from "./src/clientAuth";
import { clearClientId } from "./src/clientStore";
import { Inbox } from "./src/Inbox";
import { DevMenu } from "./src/onboarding/DevMenu";
import { readDevWalkthrough, startDevWalkthrough, stopDevWalkthrough } from "./src/onboarding/devOnboarding";
import { markOnboardingComplete, readOnboardingComplete } from "./src/onboarding/onboardingStore";
import { usePushRegistration } from "./src/push";
import { DevGallery } from "./src/screens/DevGallery";
import { O0Opening } from "./src/screens/O0Opening";
import { O1Welcome } from "./src/screens/O1Welcome";
import { O2Permissions } from "./src/screens/O2Permissions";
import { O3TestPage } from "./src/screens/O3TestPage";
import { O4FirstBot } from "./src/screens/O4FirstBot";
import { readableError } from "./src/session";
import { useAppFonts } from "./src/ui/useAppFonts";

/**
 * Dev only: `adb shell am start -a android.intent.action.VIEW -d puck://dev-gallery` opens the
 * design gallery; `puck://dev-gallery?section=Blob` shows only that component's section;
 * `puck://dev-menu` opens the dev menu.
 */
function useDevLinks() {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [section, setSection] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!__DEV__) return;
    const check = (url: string | null | undefined) => {
      if (!url) return;
      if (url.startsWith("puck://dev-gallery")) {
        const match = /[?&]section=([^&#]+)/u.exec(url);
        setSection(match?.[1] ? decodeURIComponent(match[1]) : undefined);
        setGalleryOpen(true);
      } else if (url.startsWith("puck://dev-menu")) {
        setMenuOpen(true);
      }
    };
    void Linking.getInitialURL().then(check);
    const subscription = Linking.addEventListener("url", ({ url }) => check(url));
    return () => subscription.remove();
  }, []);
  return { galleryOpen, setGalleryOpen, section, menuOpen, setMenuOpen } as const;
}

export default function App() {
  const fontsReady = useAppFonts();
  const links = useDevLinks();
  if (!fontsReady) return null;

  if (__DEV__ && links.galleryOpen) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <DevGallery onBack={() => links.setGalleryOpen(false)} section={links.section} />
        <StatusBar style="dark" />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <ConvexProvider client={convex}>
        <AppBody
          devMenuOpen={links.menuOpen}
          onDevMenuChange={links.setMenuOpen}
          onDevGallery={() => {
            links.setMenuOpen(false);
            links.setGalleryOpen(true);
          }}
        />
      </ConvexProvider>
    </GestureHandlerRootView>
  );
}

function AppBody({
  devMenuOpen,
  onDevMenuChange,
  onDevGallery,
}: {
  devMenuOpen: boolean;
  onDevMenuChange: (open: boolean) => void;
  onDevGallery: () => void;
}) {
  const clerk = useClerkAccount();
  const session = useClientSession({ clerkStatus: clerk.status, signOut: clerk.signOut });
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [devWalkthrough, setDevWalkthrough] = useState(false);
  const [step, setStep] = useState<OnboardingStep | null>(null);
  const [freshSignIn, setFreshSignIn] = useState(false);

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
  const gate = appGate({
    clerk: clerk.status,
    registration: session.status === "ready" ? "ready" : session.status === "pending" ? "pending" : "attention",
    onboarding: onboardingStatus,
    step,
    freshSignIn,
  });

  async function signedIn(account: ClerkAccount) {
    setFreshSignIn(true);
    await clerk.accept(account);
  }

  async function signOut() {
    // This phone's client row stays on the account; signing in again offers to replace it (Q11).
    await clearClientId().catch(() => {});
    setFreshSignIn(false);
    setStep(null);
    await clerk.signOut();
  }

  async function walkThroughEveryStep() {
    if (!__DEV__) return;
    await startDevWalkthrough();
    setDevWalkthrough(true);
    setOnboardingDone(false);
    setStep("welcome");
    onDevMenuChange(false);
  }

  async function finishOnboarding() {
    try {
      if (devWalkthrough && __DEV__) await stopDevWalkthrough();
      await markOnboardingComplete();
    } catch (error) {
      console.error(readableError(error));
    }
    setDevWalkthrough(false);
    setOnboardingDone(true);
    setStep(null);
  }

  function advance(from: OnboardingStep) {
    const next = nextStep(from);
    if (next) setStep(next);
    else void finishOnboarding();
  }

  if (__DEV__ && devMenuOpen) {
    return (
      <>
        <DevMenu
          onClose={() => onDevMenuChange(false)}
          onWalkThrough={() => void walkThroughEveryStep()}
          onDesignGallery={onDevGallery}
          onSignOut={() => {
            onDevMenuChange(false);
            void signOut();
          }}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <>
      {renderGate()}
      <StatusBar style="auto" />
    </>
  );

  function renderGate() {
    // The gate only reaches O2 and later with a registered client.
    const clientId = session.status === "ready" ? session.clientId : null;
    switch (gate) {
      case "opening":
        return <O0Opening />;
      case "welcome":
        return (
          <O1Welcome
            session={session}
            signedIn={clerk.status === "in"}
            onSignedIn={signedIn}
            onContinue={() => advance("welcome")}
            onOpenDevMenu={__DEV__ ? () => onDevMenuChange(true) : undefined}
          />
        );
      case "permissions":
        return clientId ? <O2Permissions clientId={clientId} onContinue={() => advance("permissions")} /> : <O0Opening />;
      case "test":
        return clientId ? <O3TestPage clientId={clientId} onContinue={() => advance("test")} /> : <O0Opening />;
      case "first-bot":
        return <O4FirstBot onFinish={() => advance("first-bot")} />;
      case "inbox":
        return (
          <SignedIn
            email={clerk.email}
            onSignOut={() => void signOut()}
            onDevReplayOnboarding={() => void walkThroughEveryStep()}
            onDevGallery={onDevGallery}
          />
        );
    }
  }
}

function SignedIn({
  email,
  onSignOut,
  onDevReplayOnboarding,
  onDevGallery,
}: {
  email: string | null;
  onSignOut: () => void;
  onDevReplayOnboarding: () => void;
  onDevGallery: () => void;
}) {
  const notifications = usePushRegistration(true);
  return (
    <Inbox
      notifications={notifications}
      email={email}
      onSignOut={onSignOut}
      onDevReplayOnboarding={onDevReplayOnboarding}
      onDevDesignGallery={__DEV__ ? onDevGallery : undefined}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
