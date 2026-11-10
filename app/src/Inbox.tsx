import { overlayAlertReady } from "puck-full-screen";
import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import { Component, type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import type { PendingAlert } from "./ChoiceScreen";
import { mutedBotIds, nextMuteExpiry, takeoverAlerts } from "./botsModel";
import { readClientId } from "./clientStore";
import { openFullScreenSettings, useFullScreenAccess } from "./fullScreenAccess";
import { clearOpenedPairing, useOpenedPairingBotId } from "./pairingOpen";
import { useOpenedQuestionId } from "./push";
import { useBots } from "./useBots";
import { readableError } from "./session";
import {
  alertLaunchTransition,
  initialAlertLaunch,
  LAUNCH_GIVE_UP_MS,
  launchIdOf,
} from "./alertLaunchMachine";
import { alertLaunchSettled, inboxShowsHome } from "./alertLaunchRouting";
import { inboxReady } from "./startupGate";
import { useHistory } from "./useHistory";
import { Text } from "./ui/Text";
import { TextLink } from "./ui/TextLink";
import { useTheme } from "./ui/theme";
import { fontFamily } from "./ui/tokens";
import type { NeedItem } from "./homeModel";
import { AlertHost, useAlertDeck } from "./screens/AlertHost";
import { ConnectedH1Home } from "./screens/H1Home";
import { ConnectedArchive } from "./screens/Archive";
import { ConnectedBotsHost } from "./screens/BotsHost";
import { ConnectedSettingsHost } from "./screens/ConnectedSettings";
import { SETTINGS_HOME, type SettingsNav } from "./screens/SettingsHost";
import { ConnectedPairingHost, type PairingStart } from "./screens/PairingHost";
import { H4Detail } from "./screens/H4Detail";
import { StackHost } from "./screens/StackHost";
import { Toast, useToast } from "./ui/Toast";
import { normalizeExpiry } from "./alertExpiry";

export function Inbox({
  notifications,
  email,
  onSignOut,
  onDevReplayOnboarding,
  onDevDesignGallery,
  onReady,
}: {
  notifications: boolean | null;
  email: string | null;
  onSignOut: () => void;
  onDevReplayOnboarding?: () => void;
  onDevDesignGallery?: () => void;
  /** Called once the inbox has its first data (the opening screen over it can go). */
  onReady?: () => void;
}) {
  return (
    <ScreenBoundary>
      <InboxBody
        onReady={onReady}
        notifications={notifications}
        email={email}
        onSignOut={onSignOut}
        onDevReplayOnboarding={onDevReplayOnboarding}
        onDevDesignGallery={onDevDesignGallery}
      />
    </ScreenBoundary>
  );
}

function InboxBody({
  notifications,
  email,
  onSignOut,
  onDevReplayOnboarding,
  onDevDesignGallery,
  onReady,
}: {
  notifications: boolean | null;
  email: string | null;
  onSignOut: () => void;
  onDevReplayOnboarding?: () => void;
  onDevDesignGallery?: () => void;
  onReady?: (() => void) | undefined;
}) {
  // undefined while the stored client id loads; null when this install has none (legacy device path).
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    readClientId()
      .then(setClientId)
      .catch(() => setClientId(null));
  }, []);
  const pending = useQuery(
    anyApi.alerts.pending,
    clientId === undefined ? "skip" : clientId ? { clientId } : {},
  ) as PendingAlert[] | undefined;
  // Waiting alerts in full (the same fields as `pending`), so a snoozed one can open from Needs you.
  const rawWaiting = useQuery(anyApi.alerts.waiting, clientId ? { clientId } : "skip") as WaitingWireAlert[] | undefined;
  // Convex sends "no expiry" as null; the alert screens read it as undefined (see `alertExpiry.ts`).
  const waiting = useMemo(() => rawWaiting?.map((alert) => normalizeExpiry(alert)), [rawWaiting]);
  // The alert a notification opened. `alertLaunchMachine` applies it on every render (so a launch is
  // visible on the first frame) and releases it once the alert has shown and left, was kept off the
  // deck, or never arrived, so normal routing comes back instead of waiting on it for the whole run.
  const rawOpenedId = useOpenedQuestionId();
  const [launch, dispatchLaunch] = useReducer(alertLaunchTransition, initialAlertLaunch);
  const launchNow = alertLaunchTransition(launch, { type: "opened", id: rawOpenedId });
  const openedId = launchIdOf(launchNow);
  // Alerts he left in a stack ("Leave the rest for later") stay off the screen until he is back in
  // the app after being away, so the stack he just closed does not open again at once.
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set());
  const leftRef = useRef(left);
  leftRef.current = left;
  const away = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (leftRef.current.size > 0) away.current = true;
      } else if (away.current) {
        away.current = false;
        setLeft(new Set());
      }
    });
    return () => subscription.remove();
  }, []);
  // The alert a tap on a "Needs you" card chose, ahead of the one a notification opened.
  const [chosenId, setChosenId] = useState<string | null>(null);
  // A muted bot's alerts do not take over the screen (no alert, not in the stack): they wait under
  // Needs you. The push is already silent; this keeps the open app quiet too. A chosen alert always shows.
  const bots = useBots(clientId);
  const [muteClock, setMuteClock] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setMuteClock(Date.now());
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const expiry = bots === undefined ? null : nextMuteExpiry(bots, Date.now());
    // setTimeout cannot wait longer than about 24 days; a longer mute is looked at again on the next change.
    const timer = expiry === null ? null : setTimeout(refresh, Math.min(expiry - Date.now() + 50, 2_000_000_000));
    return () => {
      subscription.remove();
      if (timer !== null) clearTimeout(timer);
    };
  }, [bots]);
  const muted = useMemo(() => mutedBotIds(bots ?? [], muteClock), [bots, muteClock]);
  const visible = useMemo(() => {
    const awake = takeoverAlerts(pending, muted, chosenId ?? openedId);
    return awake === undefined || left.size === 0 ? awake : awake.filter((item) => !left.has(item.questionId));
  }, [pending, left, muted, chosenId, openedId]);
  // The alert on screen stays while its receipt or its A9 card is up, after it has left `pending`.
  const deck = useAlertDeck(visible, chosenId ?? openedId);
  useEffect(() => {
    if (chosenId !== null && !deck.live.some((item) => item.questionId === chosenId)) setChosenId(null);
  }, [chosenId, deck.live]);
  const theme = useTheme().tokens;
  const toast = useToast();
  const comingLater = useCallback(() => toast.show("Coming in a later step"), [toast.show]);
  // H4, the alert detail, opened from a row on the Archive screen; and a snoozed alert opened from Needs you, shown
  // on the normal alert screen (it is not in `pending`, so `useAlertDeck` does not pick it).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [snoozedOpen, setSnoozedOpen] = useState<WaitingFullAlert | null>(null);
  const openDetail = useCallback((questionId: string) => setDetailId(questionId), []);
  const closeDetail = useCallback(() => setDetailId(null), []);
  // The Archive screen (the history), opened from Home's Archive row. Back from a row's detail comes
  // back to it, because it stays mounted under the detail.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const openArchive = useCallback(() => setArchiveOpen(true), []);
  const closeArchive = useCallback(() => setArchiveOpen(false), []);
  const closeSnoozed = useCallback(() => setSnoozedOpen(null), []);
  // Two or more waiting (not expired) alerts are the A8 stack, which stays a stack until its
  // summary's Done even as answered alerts leave `pending`. While the last alert's receipt is
  // still up (`stale`) the stack waits for it to close.
  const open = useMemo(() => {
    const now = Date.now();
    return deck.live.filter((item) => item.expiresAt === undefined || item.expiresAt > now);
  }, [deck.live]);
  const wantsStack = open.length >= 2 && !deck.stale;
  const [stacking, setStacking] = useState(false);
  useEffect(() => {
    if (wantsStack) setStacking(true);
  }, [wantsStack]);
  // H1's "Needs you": a pending alert comes back onto the screen (as the alert itself, or in a stack
  // with the others); anything else (snoozed, waiting to send) opens its detail (H4, T52).
  const openNeed = useCallback(
    (item: NeedItem) => {
      if (item.queued) {
        comingLater();
        return;
      }
      if (item.status === "snoozed") {
        const full = (waiting ?? []).find((alert) => alert.questionId === item.questionId);
        if (full) setSnoozedOpen(full);
        else comingLater();
        return;
      }
      setLeft((before) => {
        if (!before.has(item.questionId)) return before;
        const next = new Set(before);
        next.delete(item.questionId);
        return next;
      });
      setChosenId(item.questionId);
    },
    [comingLater, waiting],
  );
  const goThroughAll = useCallback(() => setLeft(new Set()), []);
  const closeStack = useCallback((heldIds: string[]) => {
    setLeft((before) => new Set([...before, ...heldIds]));
    setStacking(false);
  }, []);
  const fullScreen = useFullScreenAccess();
  // The pairing flow (B3, B4, B5): "Pair a bot" opens the keypad; a PAIRING card or a tap on the pairing
  // notification opens B4 for that bot. It waits behind an alert that is on screen.
  const [pairFlow, setPairFlow] = useState<PairingStart | null>(null);
  const openedPairing = useOpenedPairingBotId();
  useEffect(() => {
    if (openedPairing === null) return;
    setPairFlow({ kind: "approve", botId: openedPairing });
    clearOpenedPairing();
  }, [openedPairing]);
  // B1 and B2 (the Bots screens), opened from Home's Bots icon. Pairing from B1 returns to B1.
  const [botsOpen, setBotsOpen] = useState(false);
  const openBots = useCallback(() => setBotsOpen(true), []);
  const closeBots = useCallback(() => setBotsOpen(false), []);
  // S1 to S7 (Settings), opened from Home's Settings icon. Where it is lives here, so an alert that takes
  // over the screen (the test page in S5) leaves Settings where it was.
  const [settingsNav, setSettingsNav] = useState<SettingsNav | null>(null);
  const openSettings = useCallback(() => setSettingsNav(SETTINGS_HOME), []);
  const closeSettings = useCallback(() => setSettingsNav(null), []);
  const openPairing = useCallback((botId: string) => setPairFlow({ kind: "approve", botId }), []);
  const startPairing = useCallback(() => setPairFlow({ kind: "code" }), []);
  const closePairing = useCallback(
    (message?: string) => {
      setPairFlow(null);
      if (message) toast.show(message);
    },
    [toast.show],
  );
  // A new alert on screen takes over from an open detail.
  const hasAlert = deck.alert !== null;
  useEffect(() => {
    if (hasAlert) setDetailId(null);
  }, [hasAlert]);
  // The snoozed alert is let go once it has left Waiting, or was snoozed again (a new `until`), so the
  // alert screen's receipt or leave runs as it does for a pending alert.
  const snoozedNow = snoozedOpen ? (waiting ?? []).find((alert) => alert.questionId === snoozedOpen.questionId) : undefined;
  const snoozedStale =
    snoozedOpen !== null && (snoozedNow === undefined || snoozedNow.snoozedUntil !== snoozedOpen.snoozedUntil);

  async function allowFullScreen() {
    try {
      await openFullScreenSettings();
    } catch (error) {
      console.error(readableError(error));
    }
    await fullScreen.refresh();
  }

  // The opening screen stays over the app until Home has what it draws (see `startupGate.ts`): the
  // first page of history is read here too (Convex shares the one subscription with Home and Archive).
  const firstHistory = useHistory(clientId);
  const launchId = chosenId ?? openedId;
  useEffect(() => {
    if (rawOpenedId !== null) dispatchLaunch({ type: "opened", id: rawOpenedId });
  }, [rawOpenedId]);
  const loadedLists = pending !== undefined && visible !== undefined;
  const launchInPending = openedId !== null && (pending ?? []).some((item) => item.questionId === openedId);
  const launchInLive = openedId !== null && deck.live.some((item) => item.questionId === openedId);
  const launchOnDeck = openedId !== null && deck.alert?.questionId === openedId;
  useEffect(() => {
    dispatchLaunch({
      type: "observed",
      loaded: loadedLists,
      inPending: launchInPending,
      inLive: launchInLive,
      onDeck: launchOnDeck,
    });
  }, [loadedLists, launchInPending, launchInLive, launchOnDeck]);
  const launchWaiting = launchNow.phase === "waiting";
  useEffect(() => {
    if (!launchWaiting) return undefined;
    const id = setTimeout(() => dispatchLaunch({ type: "gaveUp" }), LAUNCH_GIVE_UP_MS);
    return () => clearTimeout(id);
  }, [launchWaiting, launchNow.id]);
  const dataReady = inboxReady({ clientId, pending, bots, waiting, historyLoading: firstHistory.loading });
  const launchSettled = alertLaunchSettled(
    launchId,
    pending,
    visible,
    deck.alert?.questionId ?? null,
  );
  const ready = dataReady && launchSettled;
  useEffect(() => {
    if (!rawOpenedId || !ready) return;
    // Two frames put the committed alert beneath the native cover before it fades.
    let second: number | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => overlayAlertReady(rawOpenedId));
    });
    return () => { cancelAnimationFrame(first); if (second !== undefined) cancelAnimationFrame(second); };
  }, [rawOpenedId, ready, deck.alert?.questionId]);

  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);
  // With a client id, wait for the bot list too: until it is here a muted bot's alert cannot be told apart.
  // A blank in the screen background, no words: the opening screen is on top of it.
  if (pending === undefined || (clientId && bots === undefined)) return <Blank />;
  if (stacking || wantsStack) {
    return (
      <View style={styles.stack}>
        <StackHost
          alerts={open}
          launchedByAlert={openedId !== null && open.some((item) => item.questionId === openedId)}
          onClose={closeStack}
        />
      </View>
    );
  }
  if (snoozedOpen) {
    return (
      <View style={[styles.filled, { backgroundColor: theme.bg }]}>
        <AlertHost
          alert={snoozedOpen}
          waiting={deck.waiting}
          launchedByAlert={false}
          stale={snoozedStale}
          onRelease={closeSnoozed}
        />
      </View>
    );
  }
  const alert = deck.alert;
  if (!alert && !inboxShowsHome({ deckAlert: alert, launchId, pending, visible })) {
    return <Blank />;
  }
  if (!alert && pairFlow) {
    return (
      <View style={styles.stack}>
        <ConnectedPairingHost clientId={clientId} start={pairFlow} onClose={closePairing} />
      </View>
    );
  }
  if (!alert && botsOpen) {
    return (
      <View style={styles.stack}>
        <ConnectedBotsHost clientId={clientId} onOpenPairing={openPairing} onPair={startPairing} onClose={closeBots} />
      </View>
    );
  }
  if (!alert && settingsNav) {
    return (
      <View style={styles.stack}>
        <ConnectedSettingsHost
          clientId={clientId}
          email={email}
          nav={settingsNav}
          onNav={setSettingsNav}
          onSignOut={onSignOut}
          onClose={closeSettings}
        />
      </View>
    );
  }
  if (!alert) {
    // Home stays mounted under the detail (H4), so Back shows the list that is already loaded. While
    // the detail is up Home is hidden, so it takes no touches and is not read by a screen reader.
    return (
      <View style={styles.stack}>
        <View
          style={detailId || archiveOpen ? styles.hidden : styles.stack}
          accessibilityElementsHidden={detailId !== null || archiveOpen}
          importantForAccessibility={detailId || archiveOpen ? "no-hide-descendants" : "auto"}
        >
          <ConnectedH1Home
            clientId={clientId}
            notifications={notifications}
            fullScreenAllowed={fullScreen.allowed}
            onAllowFullScreen={() => void allowFullScreen()}
            onOpenNeed={openNeed}
            onGoThroughAll={goThroughAll}
            onOpenArchive={openArchive}
            onBots={openBots}
            onSettings={openSettings}
            onPairBot={startPairing}
            onOpenPairing={openPairing}
            footer={
              <View style={styles.footer}>
                <TextLink label="Pair a bot" onPress={startPairing} />
                {email ? <FooterNote>Signed in as {email}.</FooterNote> : null}
                {__DEV__ && onDevReplayOnboarding ? (
                  <TextLink label="Dev: replay onboarding" onPress={onDevReplayOnboarding} />
                ) : null}
                {__DEV__ && onDevDesignGallery ? (
                  <TextLink label="Dev: design gallery" onPress={onDevDesignGallery} />
                ) : null}
              </View>
            }
          />
        </View>
        {archiveOpen ? (
          <View
            style={detailId ? styles.hidden : styles.overlay}
            accessibilityElementsHidden={detailId !== null}
            importantForAccessibility={detailId ? "no-hide-descendants" : "auto"}
          >
            <ConnectedArchive
              clientId={clientId}
              onOpenAlert={openDetail}
              onClose={closeArchive}
              active={detailId === null}
            />
          </View>
        ) : null}
        {detailId ? (
          <View style={styles.overlay}>
            <H4Detail questionId={detailId} onBack={closeDetail} />
          </View>
        ) : null}
        <Toast message={toast.message} visible={toast.visible} />
      </View>
    );
  }
  return (
    <View style={[styles.filled, { backgroundColor: theme.bg }]}>
      {fullScreen.allowed === false ? (
        <View style={styles.linkBar}>
          <TextLink label="Allow full-screen alerts" onPress={() => void allowFullScreen()} />
        </View>
      ) : null}
      <AlertHost
        alert={alert}
        waiting={deck.waiting}
        launchedByAlert={openedId === alert.questionId}
        stale={deck.stale}
        onRelease={deck.release}
      />
    </View>
  );
}

/** The error boundary's page: the theme's background and text, no caption styles of the old screens. */
function ErrorScreen({ message }: { message: string }) {
  const t = useTheme().tokens;
  return (
    <View style={[styles.error, { backgroundColor: t.bg }]}>
      <Text accessibilityRole="header" style={[styles.errorTitle, { color: t.ink }]}>
        Something went wrong
      </Text>
      <Text style={[styles.errorBody, { color: t.ink2 }]}>{message}</Text>
    </View>
  );
}

/** A line of quiet text under the footer link (13.5 / 600 `ink3`, as the captions elsewhere). */
function FooterNote({ children }: { children: ReactNode }) {
  const t = useTheme().tokens;
  return <Text style={[styles.note, { color: t.ink3 }]}>{children}</Text>;
}

/** The screen background, nothing else (a captioned page here showed as a flash on every start). */
function Blank() {
  const t = useTheme().tokens;
  return <View style={[styles.stack, { backgroundColor: t.bg }]} />;
}

/** A waiting alert in full (`alerts.waiting` now returns the alert's fields, as `alerts.pending` does). */
type WaitingFullAlert = PendingAlert & { status: "pending" | "snoozed"; snoozedUntil: number | null };
type WaitingWireAlert = Omit<WaitingFullAlert, "expiresAt"> & { expiresAt: number | null };

class ScreenBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: readableError(error) };
  }

  render() {
    if (this.state.message) return <ErrorScreen message={this.state.message} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  footer: {
    paddingTop: 22,
    paddingHorizontal: 22,
  },
  linkBar: {
    paddingHorizontal: 26,
    paddingTop: 48,
  },
  stack: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  filled: {
    flex: 1,
  },
  error: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  errorTitle: { fontFamily: fontFamily.black, fontSize: 24, fontWeight: "900" },
  errorBody: { fontFamily: fontFamily.semiBold, fontSize: 15.5, fontWeight: "600", marginTop: 8 },
  note: { fontFamily: fontFamily.semiBold, fontSize: 13.5, fontWeight: "600", paddingVertical: 4 },
});
