import type { ClerkAccount } from "@puck/shared";
import { ConvexProvider, useConvex } from "convex/react";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
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
import { recordQueuedAnswer, useAnswerQueueFlush } from "./src/screens/A10Offline";
import { useWakeSnoozed } from "./src/screens/A11Snooze";
import { AlertHost } from "./src/screens/AlertHost";
import { AStack, type StackAnswer, type StackGone } from "./src/screens/AStack";
import { DevGallery } from "./src/screens/DevGallery";
import { freshGroup, freshSample, ALERT_SAMPLE_GROUPS, ALERT_SAMPLES } from "./src/screens/gallery/samples";
import { StackSummary } from "./src/screens/StackSummary";
import { O0Opening } from "./src/screens/O0Opening";
import { O1Welcome } from "./src/screens/O1Welcome";
import { O2Permissions } from "./src/screens/O2Permissions";
import { O3TestPage } from "./src/screens/O3TestPage";
import { O4FirstBot } from "./src/screens/O4FirstBot";
import { goneCopy } from "./src/receiptCopy";
import { readableError } from "./src/session";
import { Toast, useToast } from "./src/ui/Toast";
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

/**
 * Dev only: `adb shell am start -a android.intent.action.VIEW -d "puck://dev-alert?sample=sheldon"`
 * opens an alert screen with a sample alert (`src/screens/gallery/samples`; `fyi` is the other
 * one so far). Answering shows what would have been sent and returns to the sample. A sample
 * that names a group (`sample=three-at-once`) opens its alerts as the A8 stack instead.
 */
function useDevAlertLink() {
  const [sample, setSample] = useState<string | null>(null);
  useEffect(() => {
    if (!__DEV__) return;
    const check = (url: string | null | undefined) => {
      if (!url?.startsWith("puck://dev-alert")) return;
      const match = /[?&]sample=([^&#]+)/u.exec(url);
      setSample(match?.[1] ? decodeURIComponent(match[1]) : "sheldon");
    };
    void Linking.getInitialURL().then(check);
    const subscription = Linking.addEventListener("url", ({ url }) => check(url));
    return () => subscription.remove();
  }, []);
  return { sample, closeSample: () => setSample(null) } as const;
}

/** A sample alert in the real alert host, with an `onAnswer` that never touches the backend. */
function DevAlertSample({ name }: { name: string }) {
  const toast = useToast();
  // A new `round` (the time the sample was opened) gives the sample fresh times and a fresh screen.
  const [round, setRound] = useState(() => Date.now());
  const alert = useMemo(() => freshSample(name, round), [name, round]);
  const group = useMemo(() => (alert ? null : freshGroup(name, round)), [alert, name, round]);
  // The stack's fake delivery: each answered card goes sending, then sent, then delivered, so the
  // statuses and the summary can be seen with no backend. `three-with-cancel` also has the bot cancel
  // its last card after a few seconds, to see a card that is no longer needed.
  const [fakeAnswers, setFakeAnswers] = useState<Record<string, StackAnswer>>({});
  const [fakeGone, setFakeGone] = useState<Record<string, StackGone>>({});
  const fakeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const timers = fakeTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (!group || name !== "three-with-cancel") return;
    const target = group[group.length - 1];
    if (!target) return;
    const id = setTimeout(() => {
      const copy = goneCopy({ reason: "cancelled", botName: target.botName });
      setFakeGone((all) => ({ ...all, [target.questionId]: { title: copy.title, sub: copy.sub } }));
    }, 6000);
    return () => clearTimeout(id);
  }, [group, name]);
  if (group) {
    // The stack keeps its own answered cards and moves on by itself, so nothing here starts it over.
    const onGroupAnswer = async (
      target: { questionId: string; botName: string },
      optionIds: string[],
      customReply?: string,
    ) => {
      toast.show(
        `Would send: ${target.botName}: ${optionIds.join(", ")}${customReply ? ` + "${customReply}"` : ""}`,
      );
      const id = target.questionId;
      const answer = { optionIds, ...(customReply ? { customReply } : {}) };
      const move = (status: StackAnswer["status"]) =>
        setFakeAnswers((all) => ({ ...all, [id]: { ...answer, status } }));
      move("sending");
      fakeTimers.current.push(setTimeout(() => move("sent"), 700), setTimeout(() => move("delivered"), 2000));
    };
    return (
      <View style={styles.root}>
        <AStack
          key={round}
          alerts={group}
          onAnswer={onGroupAnswer}
          answers={fakeAnswers}
          gone={fakeGone}
          renderSummary={({ alerts, answers, gone, jumpTo }) => (
            <StackSummary
              alerts={alerts}
              answers={answers}
              gone={gone}
              jumpTo={jumpTo}
              onDone={() => toast.show("Would close the stack")}
            />
          )}
        />
        <Toast message={toast.message} visible={toast.visible} />
      </View>
    );
  }
  if (!alert) {
    return (
      <View style={styles.root}>
        <Text style={styles.devNote}>
          Unknown sample: {name}. Known: {[...Object.keys(ALERT_SAMPLES), ...Object.keys(ALERT_SAMPLE_GROUPS)].join(", ")}.
        </Text>
      </View>
    );
  }
  const onAnswer = async (optionIds: string[], customReply?: string) => {
    toast.show(`Would send: ${optionIds.join(", ")}${customReply ? ` + "${customReply}"` : ""}`);
    // About 1.2 s in all: in flight, then sent, then back to the same sample to try again.
    await new Promise((resolve) => setTimeout(resolve, 700));
    // Long enough to see the receipt's "Delivered" line before the sample starts over.
    setTimeout(() => setRound(Date.now()), 1800);
  };
  const onSnooze = async (until: number | null) => {
    toast.show(`Would snooze: ${until === null ? "until I'm back" : `until ${new Date(until).toLocaleTimeString()}`}`);
    setTimeout(() => setRound(Date.now()), 1500);
  };
  return (
    <View style={styles.root}>
      <AlertHost key={round} alert={alert} waiting={1} onAnswer={onAnswer} onSnooze={onSnooze} />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
}

export default function App() {
  const fontsReady = useAppFonts();
  const links = useDevLinks();
  const alertLink = useDevAlertLink();
  if (!fontsReady) return null;

  if (__DEV__ && alertLink.sample) {
    // The Convex provider is only here so a sample for a screen that is not rebuilt yet (the old
    // multi and swipe screens) can render; the new screens never use it.
    return (
      <GestureHandlerRootView style={styles.root}>
        <ConvexProvider client={convex}>
          <DevAlertSample name={alertLink.sample} />
        </ConvexProvider>
        <StatusBar style="dark" />
      </GestureHandlerRootView>
    );
  }

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
            clientId={clientId}
            email={clerk.email}
            onSignOut={() => void signOut()}
            onDevReplayOnboarding={() => void walkThroughEveryStep()}
            onDevGallery={onDevGallery}
          />
        );
    }
  }
}

/**
 * Things that run while signed in, whatever screen is up: send the answers kept on the phone when
 * the connection is back (A10), and wake "until I'm back" snoozes when the app comes forward (A11).
 */
function BackgroundDuties({ clientId }: { clientId: string | null }) {
  const client = useConvex();
  useAnswerQueueFlush((item) => recordQueuedAnswer(client, clientId ?? "", item).then(() => undefined), {
    enabled: clientId !== null,
  });
  useWakeSnoozed(clientId);
  return null;
}

function SignedIn({
  clientId,
  email,
  onSignOut,
  onDevReplayOnboarding,
  onDevGallery,
}: {
  clientId: string | null;
  email: string | null;
  onSignOut: () => void;
  onDevReplayOnboarding: () => void;
  onDevGallery: () => void;
}) {
  const notifications = usePushRegistration(true);
  return (
    <>
      <BackgroundDuties clientId={clientId} />
      <Inbox
        notifications={notifications}
        email={email}
        onSignOut={onSignOut}
        onDevReplayOnboarding={onDevReplayOnboarding}
        onDevDesignGallery={__DEV__ ? onDevGallery : undefined}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  devNote: {
    marginTop: 80,
    paddingHorizontal: 24,
    fontSize: 16,
  },
});
