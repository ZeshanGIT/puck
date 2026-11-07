import type { ClerkAccount } from "@puck/shared";
import { ConvexProvider, useConvex } from "convex/react";
import { anyApi } from "convex/server";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Text } from "./src/ui/Text";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { appGate, nextStep, type OnboardingStatus, type OnboardingStep } from "./src/accountGate";
import { useClerkAccount } from "./src/clerkAccount";
import { convex } from "./src/client";
import { useClientSession } from "./src/clientAuth";
import { clearAnswerQueue } from "./src/answerQueue";
import { clearClientId, readClientId } from "./src/clientStore";
import { signOutPhone } from "./src/signOutFlow";
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
import { DevSettings } from "./src/screens/gallery/DevSettings";
import { H1Home } from "./src/screens/H1Home";
import { H4DetailView } from "./src/screens/H4Detail";
import { BotsHost, type BotsSource } from "./src/screens/BotsHost";
import type { BotListItem } from "./src/botsModel";
import type { BotBypass } from "./src/localSettings";
import { PairingHost, type PairingSource, type PairingStart } from "./src/screens/PairingHost";
import type { PairingRequest } from "./src/pairingModel";
import {
  DETAIL_SAMPLE_NAMES,
  freshDetail,
  freshGroup,
  freshHome,
  isDetailSample,
  freshSample,
  isHomeSample,
  isPairingSample,
  isBotsSample,
  isSettingsSample,
  SETTINGS_SAMPLE_NAMES,
  freshBots,
  BOTS_SAMPLE_NAMES,
  freshPairing,
  PAIRING_SAMPLE_NAMES,
  HOME_SAMPLE_NAMES,
  ALERT_SAMPLE_GROUPS,
  ALERT_SAMPLES,
} from "./src/screens/gallery/samples";
import { StackSummary } from "./src/screens/StackSummary";
import { O0Opening } from "./src/screens/O0Opening";
import { O1Welcome } from "./src/screens/O1Welcome";
import { O2Permissions } from "./src/screens/O2Permissions";
import { O3TestPage } from "./src/screens/O3TestPage";
import { O4FirstBot } from "./src/screens/O4FirstBot";
import { knownBots, needsYou } from "./src/homeModel";
import { goneCopy } from "./src/receiptCopy";
import { readableError } from "./src/session";
import { ThemeProvider, type ThemeMode } from "./src/ui/theme";
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

/** The `theme` query value of a dev-alert link: `dark`, `night` or `light`; anything else follows the system. */
function parseDevTheme(value: string | undefined): ThemeMode | undefined {
  return value === "dark" || value === "night" || value === "light" ? value : undefined;
}

/**
 * Dev only: `adb shell am start -a android.intent.action.VIEW -d "puck://dev-alert?sample=sheldon"`
 * opens an alert screen with a sample alert (`src/screens/gallery/samples`; `fyi` is the other
 * one so far). Answering shows what would have been sent and returns to the sample. A sample
 * that names a group (`sample=three-at-once`) opens its alerts as the A8 stack instead.
 */
function useDevAlertLink() {
  const [sample, setSample] = useState<string | null>(null);
  // `&theme=dark|night|light` wraps the sample in that mode (the app itself follows the system
  // setting; this lets a sample be checked in dark or night without changing the phone).
  const [theme, setTheme] = useState<ThemeMode | undefined>(undefined);
  useEffect(() => {
    if (!__DEV__) return;
    const check = (url: string | null | undefined) => {
      if (!url?.startsWith("puck://dev-alert")) return;
      const match = /[?&]sample=([^&#]+)/u.exec(url);
      setSample(match?.[1] ? decodeURIComponent(match[1]) : "sheldon");
      setTheme(parseDevTheme(/[?&]theme=([^&#]+)/u.exec(url)?.[1]));
    };
    void Linking.getInitialURL().then(check);
    const subscription = Linking.addEventListener("url", ({ url }) => check(url));
    return () => subscription.remove();
  }, []);
  return { sample, theme, closeSample: () => setSample(null) } as const;
}

/** H4 Alert detail with fake data (`sample=detail`, `detail-ok`): no backend; Try again just shows a Toast. */
function DevDetail({ name, onClose }: { name: string; onClose: () => void }) {
  const [round] = useState(() => Date.now());
  const sample = useMemo(() => freshDetail(name, round), [name, round]);
  const [now, setNow] = useState(round);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const retry = useCallback(async () => "Sample only: nothing was sent", []);
  return (
    <View style={styles.root}>
      <H4DetailView alert={sample} now={now} onBack={onClose} onRetry={retry} />
    </View>
  );
}

/** H1 Home with fake data (`sample=home`, `home-clear`, `home-empty`): no backend, Load more brings older rows. */
function DevHome({ name }: { name: string }) {
  const toast = useToast();
  // The PAIRING card (`home-pairing`) and Pair a bot open the pairing flow on the sample's fake requests.
  const [pairing, setPairing] = useState<PairingStart | null>(null);
  const [round] = useState(() => Date.now());
  const sample = useMemo(() => freshHome(name, round), [name, round]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(round);
  // The `live-*` samples: running tasks that move on every 3 s (a step, a log line, then done).
  const [live, setLive] = useState(() => sample?.live);
  useEffect(() => {
    const script = sample?.liveScript;
    if (!script) return;
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      setLive((before) => (before ? (script(before, tick, Date.now()) ?? before) : before));
    }, 3000);
    return () => clearInterval(id);
  }, [sample]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!sample) return null;
  const history = loaded ? [...sample.history, ...sample.older] : sample.history;
  const needs = needsYou(sample.waiting, { now, queuedIds: new Set(sample.queuedIds) });
  const later = () => toast.show("Coming in a later step");
  if (pairing) {
    return (
      <View style={styles.root}>
        <DevPairingFlow
          requests={sample.pairings ?? []}
          start={pairing}
          onClose={(message) => {
            setPairing(null);
            if (message) toast.show(message);
          }}
        />
        <Toast message={toast.message} visible={toast.visible} />
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <H1Home
        banners={sample.banners}
        onBanner={later}
        needs={needs}
        history={history}
        historyStatus={loaded || sample.older.length === 0 ? "exhausted" : "canLoadMore"}
        onLoadMore={() => setLoaded(true)}
        bots={knownBots(sample.waiting, history)}
        noBots={sample.noBots}
        now={now}
        onOpenNeed={later}
        onGoThroughAll={() => toast.show("Would open the stack")}
        onOpenAlert={later}
        onBots={later}
        onSettings={later}
        onPairBot={() => setPairing({ kind: "code" })}
        pairings={sample.pairings}
        onOpenPairing={(botId) => setPairing({ kind: "approve", botId })}
        live={live}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
}

/** A pairing source on fake requests: approving takes a moment and then drops the request, as the backend does. */
function useFakePairingSource(initial: PairingRequest[]): PairingSource {
  const [requests, setRequests] = useState(initial);
  return useMemo<PairingSource>(
    () => ({
      requests,
      approve: async (code) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const hit = requests.find((request) => request.pairingCode === code);
        if (!hit) throw new Error("pairing code is not valid");
        setRequests((all) => all.filter((request) => request !== hit));
        return { botId: hit.botId };
      },
      reject: async (botId) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        setRequests((all) => all.filter((request) => request.botId !== botId));
      },
    }),
    [requests],
  );
}

/** The real pairing flow (B3, B4, B5) with no backend. */
function DevPairingFlow({
  requests,
  start,
  onClose,
}: {
  requests: PairingRequest[];
  start: PairingStart;
  onClose: (message?: string) => void;
}) {
  const source = useFakePairingSource(requests);
  return <PairingHost source={source} start={start} onClose={onClose} />;
}

/** B1 and B2 on fake bots (`sample=bots`, `bots-empty`, `bot`, `bot-muted`): every change works on the fake data. */
function DevBots({ name }: { name: string }) {
  const toast = useToast();
  const [round, setRound] = useState(() => Date.now());
  const sample = useMemo(() => freshBots(name, round), [name, round]);
  const [bots, setBots] = useState<BotListItem[]>(() => sample?.bots ?? []);
  const [bypass, setBypass] = useState<Record<string, BotBypass>>(() => sample?.bypass ?? {});
  const { show } = toast;
  const source = useMemo<BotsSource>(
    () => ({
      bots,
      bypass,
      mute: async (botId, until) => setBots((all) => all.map((bot) => (bot.botId === botId ? { ...bot, mutedUntil: until } : bot))),
      setColour: async (botId, colour) => setBots((all) => all.map((bot) => (bot.botId === botId ? { ...bot, colour } : bot))),
      setBypass: async (botId, change) =>
        setBypass((all) => {
          const next: BotBypass = { ...all[botId] };
          if (change.dnd === null) delete next.dnd;
          else if (change.dnd !== undefined) next.dnd = change.dnd;
          if (change.silent === null) delete next.silent;
          else if (change.silent !== undefined) next.silent = change.silent;
          return { ...all, [botId]: next };
        }),
      remove: async (botId) => setBots((all) => all.filter((bot) => bot.botId !== botId)),
      openSound: async (kind) => {
        show(`Would open Android's ${kind} sound settings`);
        return true;
      },
    }),
    [bots, bypass, show],
  );
  if (!sample) return null;
  return (
    <View style={styles.root}>
      <BotsHost
        key={round}
        source={source}
        start={sample.start}
        onPair={() => show("Would open the pairing flow")}
        onClose={() => {
          show("Sample over. Starting again");
          setTimeout(() => {
            const next = Date.now();
            const fresh = freshBots(name, next);
            setBots(fresh?.bots ?? []);
            setBypass(fresh?.bypass ?? {});
            setRound(next);
          }, 1200);
        }}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
}

/** B3, B4 or B5 on fake data (`sample=pair-code`, `pair-approve`, `pair-approve-nocolour`, `pair-meet`). */
function DevPairing({ name }: { name: string }) {
  const toast = useToast();
  // A new `round` starts the sample over after the flow closes.
  const [round, setRound] = useState(() => Date.now());
  const sample = useMemo(() => freshPairing(name, round), [name, round]);
  const { show } = toast;
  useEffect(() => {
    if (sample) show(sample.hint);
  }, [sample, show]);
  if (!sample) return null;
  return (
    <View style={styles.root}>
      <DevPairingFlow
        key={`${name}-${round}`}
        requests={sample.requests}
        start={sample.start}
        onClose={(message) => {
          show(message ?? "Sample over. Starting again");
          setTimeout(() => setRound(Date.now()), 1500);
        }}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
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
          Unknown sample: {name}. Known: {[...Object.keys(ALERT_SAMPLES), ...Object.keys(ALERT_SAMPLE_GROUPS), ...HOME_SAMPLE_NAMES, ...DETAIL_SAMPLE_NAMES, ...PAIRING_SAMPLE_NAMES, ...BOTS_SAMPLE_NAMES, ...SETTINGS_SAMPLE_NAMES].join(", ")}.
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
          <ThemeProvider mode={alertLink.theme}>
          {isHomeSample(alertLink.sample) ? (
            <DevHome key={alertLink.sample} name={alertLink.sample} />
          ) : isBotsSample(alertLink.sample) ? (
            <DevBots key={alertLink.sample} name={alertLink.sample} />
          ) : isSettingsSample(alertLink.sample) ? (
            <DevSettings key={alertLink.sample} name={alertLink.sample} />
          ) : isPairingSample(alertLink.sample) ? (
            <DevPairing key={alertLink.sample} name={alertLink.sample} />
          ) : isDetailSample(alertLink.sample) ? (
            <DevDetail name={alertLink.sample} onClose={alertLink.closeSample} />
          ) : (
            <DevAlertSample name={alertLink.sample} />
          )}
          </ThemeProvider>
        </ConvexProvider>
        <StatusBar style={alertLink.theme === "dark" || alertLink.theme === "night" ? "light" : "dark"} />
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
  const [signingOut, setSigningOut] = useState(false);
  const convexClient = useConvex();

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
    // Sign-out removes this phone's client row so it stops being paged (best effort, 3 s), clears the stored
    // client id and any answers still waiting to send (they belong to that row), then ends the Clerk session.
    // The opening screen covers the moments in between, so the inbox's queries never meet a missing row.
    setSigningOut(true);
    try {
      await signOutPhone({
        removeClient: async () => {
          const clientId = await readClientId();
          if (clientId) await convexClient.mutation(anyApi.clients.remove, { clientId });
        },
        clearLocal: async () => {
          setFreshSignIn(false);
          setStep(null);
          await clearClientId();
          await clearAnswerQueue().catch(() => {});
        },
        endSession: () => clerk.signOut(),
      });
    } catch (error) {
      console.error(readableError(error));
    } finally {
      setSigningOut(false);
    }
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
    if (signingOut) return <O0Opening />;
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
