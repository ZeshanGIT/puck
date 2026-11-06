import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import type { PendingAlert } from "./ChoiceScreen";
import { readClientId } from "./clientStore";
import { openFullScreenSettings, useFullScreenAccess } from "./fullScreenAccess";
import { PairingScreen } from "./Pairing";
import { useOpenedQuestionId } from "./push";
import { readableError } from "./session";
import { PuckBody, PuckTextLink, PuckTitle } from "./components/PuckButton";
import { PuckScreen } from "./components/PuckScreen";
import type { NeedItem } from "./homeModel";
import { AlertHost, useAlertDeck } from "./screens/AlertHost";
import { ConnectedH1Home } from "./screens/H1Home";
import { H4Detail } from "./screens/H4Detail";
import { StackHost } from "./screens/StackHost";
import { Toast, useToast } from "./ui/Toast";

export function Inbox({
  notifications,
  email,
  onSignOut,
  onDevReplayOnboarding,
  onDevDesignGallery,
}: {
  notifications: boolean | null;
  email: string | null;
  onSignOut: () => void;
  onDevReplayOnboarding?: () => void;
  onDevDesignGallery?: () => void;
}) {
  return (
    <ScreenBoundary>
      <InboxBody
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
}: {
  notifications: boolean | null;
  email: string | null;
  onSignOut: () => void;
  onDevReplayOnboarding?: () => void;
  onDevDesignGallery?: () => void;
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
  const waiting = useQuery(anyApi.alerts.waiting, clientId ? { clientId } : "skip") as WaitingFullAlert[] | undefined;
  const openedId = useOpenedQuestionId();
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
  const visible = useMemo(
    () => (pending === undefined || left.size === 0 ? pending : pending.filter((item) => !left.has(item.questionId))),
    [pending, left],
  );
  // The alert on screen stays while its receipt or its A9 card is up, after it has left `pending`.
  // The alert a tap on a "Needs you" card chose, ahead of the one a notification opened.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const deck = useAlertDeck(visible, chosenId ?? openedId);
  useEffect(() => {
    if (chosenId !== null && !deck.live.some((item) => item.questionId === chosenId)) setChosenId(null);
  }, [chosenId, deck.live]);
  const toast = useToast();
  const comingLater = useCallback(() => toast.show("Coming in a later step"), [toast.show]);
  // H4, the alert detail, opened from an Earlier row; and a snoozed alert opened from Needs you, shown
  // on the normal alert screen (it is not in `pending`, so `useAlertDeck` does not pick it).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [snoozedOpen, setSnoozedOpen] = useState<WaitingFullAlert | null>(null);
  const openDetail = useCallback((questionId: string) => setDetailId(questionId), []);
  const closeDetail = useCallback(() => setDetailId(null), []);
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
  const [pairing, setPairing] = useState(false);
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

  if (pairing) {
    return <PairingScreen onClose={() => setPairing(false)} />;
  }
  if (pending === undefined) {
    return (
      <PuckScreen center>
        <PuckBody>Looking for alerts…</PuckBody>
      </PuckScreen>
    );
  }
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
      <View style={styles.filled}>
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
  if (!alert) {
    if (detailId) {
      return (
        <View style={styles.stack}>
          <H4Detail questionId={detailId} onBack={closeDetail} />
        </View>
      );
    }
    return (
      <View style={styles.stack}>
        <ConnectedH1Home
          clientId={clientId}
          notifications={notifications}
          fullScreenAllowed={fullScreen.allowed}
          onAllowFullScreen={() => void allowFullScreen()}
          onOpenNeed={openNeed}
          onGoThroughAll={goThroughAll}
          onOpenAlert={openDetail}
          onBots={comingLater}
          onSettings={comingLater}
          onPairBot={() => setPairing(true)}
          footer={
            <View style={styles.footer}>
              <PuckTextLink label="Pair a bot" onPress={() => setPairing(true)} />
              {email ? <PuckBody>Signed in as {email}.</PuckBody> : null}
              {__DEV__ && onDevReplayOnboarding ? (
                <PuckTextLink label="Dev: replay onboarding" onPress={onDevReplayOnboarding} />
              ) : null}
              {__DEV__ && onDevDesignGallery ? (
                <PuckTextLink label="Dev: design gallery" onPress={onDevDesignGallery} />
              ) : null}
              <PuckTextLink label="Sign out" onPress={onSignOut} />
            </View>
          }
        />
        <Toast message={toast.message} visible={toast.visible} />
      </View>
    );
  }
  return (
    <View style={styles.filled}>
      {fullScreen.allowed === false ? (
        <View style={styles.linkBar}>
          <PuckTextLink label="Allow full-screen alerts" onPress={() => void allowFullScreen()} />
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

/** A waiting alert in full (`alerts.waiting` now returns the alert's fields, as `alerts.pending` does). */
type WaitingFullAlert = PendingAlert & { status: "pending" | "snoozed"; snoozedUntil: number | null };

class ScreenBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: readableError(error) };
  }

  render() {
    if (this.state.message) {
      return (
        <PuckScreen center>
          <PuckTitle>Something went wrong</PuckTitle>
          <PuckBody>{this.state.message}</PuckBody>
        </PuckScreen>
      );
    }
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
  filled: {
    flex: 1,
    backgroundColor: "#f3e6dc",
  },
});
