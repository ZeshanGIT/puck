import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import { Component, type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { ChoiceScreen, type PendingAlert } from "./ChoiceScreen";
import { SwipeScreen } from "./SwipeScreen";
import { openFullScreenSettings, useFullScreenAccess } from "./fullScreenAccess";
import { PairingScreen } from "./Pairing";
import { useOpenedQuestionId } from "./push";
import { readableError } from "./session";
import { PuckBlob } from "./components/PuckBlob";
import { PuckBody, PuckButton, PuckKicker, PuckTextLink, PuckTitle } from "./components/PuckButton";
import { PuckScreen } from "./components/PuckScreen";

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
  const pending = useQuery(anyApi.alerts.pending) as PendingAlert[] | undefined;
  const openedId = useOpenedQuestionId();
  const fullScreen = useFullScreenAccess();
  const [pairing, setPairing] = useState(false);

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
  const alert = pending.find((item) => item.questionId === openedId) ?? pending[0];
  if (!alert) {
    return (
      <PuckScreen>
        <ScrollView contentContainerStyle={styles.idleScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.idleHero}>
            <PuckBlob size={132} mood="idle" />
          </View>
          <PuckKicker>Puck</PuckKicker>
          <PuckTitle>Nothing paging you</PuckTitle>
          <PuckBody>When a bot sends an alert, this screen gives way to the full reply flow.</PuckBody>
          {email ? <PuckBody>Signed in as {email}.</PuckBody> : null}
          {notifications === false ? (
            <PuckBody>Notifications are off — bots cannot reach this phone while Puck is closed.</PuckBody>
          ) : null}
          {fullScreen.allowed === false ? (
            <PuckButton label="Allow full-screen alerts" onPress={() => void allowFullScreen()} variant="ghost" />
          ) : null}
          <PuckButton label="Pair a bot" onPress={() => setPairing(true)} />
          {__DEV__ && onDevReplayOnboarding ? (
            <PuckTextLink label="Dev: replay onboarding" onPress={onDevReplayOnboarding} />
          ) : null}
          {__DEV__ && onDevDesignGallery ? (
            <PuckTextLink label="Dev: design gallery" onPress={onDevDesignGallery} />
          ) : null}
          <PuckTextLink label="Sign out" onPress={onSignOut} />
        </ScrollView>
      </PuckScreen>
    );
  }
  return (
    <View style={styles.filled}>
      {fullScreen.allowed === false ? (
        <View style={styles.linkBar}>
          <PuckTextLink label="Allow full-screen alerts" onPress={() => void allowFullScreen()} />
        </View>
      ) : null}
      {alert.presentation === "swipe" ? (
        <SwipeScreen alert={alert} waiting={pending.length} />
      ) : (
        <ChoiceScreen alert={alert} waiting={pending.length} />
      )}
    </View>
  );
}

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
  idleScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 24,
  },
  idleHero: {
    alignItems: "center",
    marginBottom: 12,
  },
  linkBar: {
    paddingHorizontal: 26,
    paddingTop: 48,
  },
  filled: {
    flex: 1,
    backgroundColor: "#f3e6dc",
  },
});
