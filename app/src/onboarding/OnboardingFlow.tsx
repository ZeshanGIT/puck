import * as Device from "expo-device";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, Easing, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { ClerkAccount } from "@puck/shared";
import type { GateStatus } from "../accountGate";
import { OnboardingBlobHero, type OnboardingBlobHeroHandle } from "../components/OnboardingBlobHero";
import { OnboardingProgress } from "../components/OnboardingProgress";
import { PuckBody, PuckButton, PuckError, PuckKicker, PuckTextLink, PuckTitle } from "../components/PuckButton";
import { PuckScreen } from "../components/PuckScreen";
import { convexSiteUrl } from "../deployment";
import { saveDeviceSecret } from "../deviceStore";
import { claimDevice, readableError } from "../session";
import { puckColors, puckFonts } from "../theme/puckTheme";
import { startDevWalkthrough, stopDevWalkthrough } from "./devOnboarding";
import { openFullScreenSettings, readFullScreenAllowed } from "./fullScreenSetup";
import { useGoogleSignIn } from "./googleSignIn";
import { ensureNotificationPermission, readNotificationPermission } from "./notificationSetup";
import { markOnboardingComplete } from "./onboardingStore";

type StepId = "welcome" | "sign-in" | "this-phone" | "claim" | "notifications" | "fullscreen" | "ready";

const ALL_STEPS: StepId[] = ["welcome", "sign-in", "this-phone", "claim", "notifications", "fullscreen", "ready"];

export function OnboardingFlow({
  clerkStatus,
  deviceStatus,
  email,
  devWalkthrough,
  onAcceptAccount,
  onDeviceClaimed,
  onSignOut,
  onFinished,
  onDevWalkthroughChange,
}: {
  clerkStatus: GateStatus;
  deviceStatus: GateStatus;
  email: string | null;
  devWalkthrough: boolean;
  onAcceptAccount: (account: ClerkAccount) => Promise<void>;
  onDeviceClaimed: (secret: string) => void;
  onSignOut: () => void;
  onFinished: () => void;
  onDevWalkthroughChange: (active: boolean) => void;
}) {
  const steps = useMemo(
    () => (devWalkthrough && __DEV__ ? ALL_STEPS : buildSteps(clerkStatus, deviceStatus)),
    [clerkStatus, deviceStatus, devWalkthrough],
  );
  const [stepId, setStepId] = useState<StepId>(() => steps[0] ?? "ready");
  const [claimCode, setClaimCode] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [notifyDenied, setNotifyDenied] = useState(false);
  const [fullScreenOk, setFullScreenOk] = useState<boolean | null>(null);
  const blobHeroRef = useRef<OnboardingBlobHeroHandle>(null);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentShift = useRef(new Animated.Value(0)).current;

  const phoneLabel = Device.modelName ?? Device.deviceName ?? "This phone";
  const stepIndex = Math.max(0, steps.indexOf(stepId));

  const google = useGoogleSignIn(async (account) => {
    await onAcceptAccount(account);
    advance("sign-in");
  });

  useEffect(() => {
    if (!steps.includes(stepId)) setStepId(steps[0] ?? "ready");
  }, [stepId, steps]);

  useEffect(() => {
    let cancelled = false;
    readNotificationPermission().then((status) => {
      if (!cancelled && status === "granted") setNotifyDenied(false);
    });
    setFullScreenOk(readFullScreenAllowed());
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setFullScreenOk(readFullScreenAllowed());
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [stepId]);

  function animateStepChange(next: StepId) {
    blobHeroRef.current?.reactToAdvance();
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(contentShift, { toValue: 10, duration: 140, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setStepId(next);
      contentShift.setValue(-8);
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(contentShift, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    });
  }

  function advance(from: StepId) {
    const at = steps.indexOf(from);
    const next = steps[at + 1];
    if (next) animateStepChange(next);
  }

  function next() {
    advance(stepId);
  }

  async function submitClaim() {
    if (devWalkthrough && __DEV__ && deviceStatus === "in") {
      advance("claim");
      return;
    }
    setClaimBusy(true);
    setClaimError(null);
    try {
      const claimed = await claimDevice(convexSiteUrl, claimCode);
      await saveDeviceSecret(claimed.secret);
      onDeviceClaimed(claimed.secret);
      advance("claim");
    } catch (caught) {
      setClaimError(readableError(caught));
    } finally {
      setClaimBusy(false);
    }
  }

  async function allowNotifications() {
    const granted = await ensureNotificationPermission();
    setNotifyDenied(!granted);
    if (granted) next();
  }

  async function openFullScreen() {
    await openFullScreenSettings();
    setFullScreenOk(readFullScreenAllowed());
  }

  async function finish() {
    if (devWalkthrough && __DEV__) await stopDevWalkthrough();
    await markOnboardingComplete();
    onDevWalkthroughChange(false);
    onFinished();
  }

  async function replayOnboardingDev() {
    if (!__DEV__) return;
    await startDevWalkthrough();
    onDevWalkthroughChange(true);
    animateStepChange("welcome");
  }

  const mood = stepId === "ready" ? "happy" : "idle";
  const signedInAlready = clerkStatus === "in";
  const deviceLinked = deviceStatus === "in";

  return (
    <PuckScreen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <OnboardingProgress index={stepIndex} total={steps.length} />
        {__DEV__ ? (
          <PuckTextLink label="Dev: walk through every step" onPress={() => void replayOnboardingDev()} />
        ) : null}
        <OnboardingBlobHero ref={blobHeroRef} stepId={stepId} mood={mood} />

        <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentShift }] }}>
          {stepId === "welcome" ? (
            <>
              <PuckKicker>Puck</PuckKicker>
              <PuckTitle>Your agents can page you</PuckTitle>
              <PuckBody>Full-screen alerts on this phone. Tap an answer, or type back — like a playful pager.</PuckBody>
              <PuckButton label="Let's go" onPress={next} />
            </>
          ) : null}

          {stepId === "sign-in" ? (
            <>
              <PuckKicker>Step 1</PuckKicker>
              <PuckTitle>Sign in with Google</PuckTitle>
              <PuckBody>Same account as the puck CLI, so bots know it's you.</PuckBody>
              {signedInAlready ? (
                <PuckBody>{email ? `Already signed in as ${email}.` : "Already signed in on this phone."}</PuckBody>
              ) : null}
              {google.error ? <PuckError>{google.error}</PuckError> : null}
              {signedInAlready ? (
                <PuckButton label="Continue" onPress={next} />
              ) : (
                <PuckButton
                  label={google.busy ? "Signing in…" : "Continue with Google"}
                  onPress={() => void google.start()}
                  disabled={google.busy}
                />
              )}
              <PuckTextLink label="Sign out" onPress={() => void onSignOut()} />
            </>
          ) : null}

          {stepId === "this-phone" ? (
            <>
              <PuckKicker>Step 2</PuckKicker>
              <PuckTitle>This phone</PuckTitle>
              <PuckBody>
                {email ? `Signed in as ${email}. ` : ""}
                {phoneLabel} will receive alerts unless a bot targets another client.
              </PuckBody>
              <PuckButton label="Continue" onPress={next} />
            </>
          ) : null}

          {stepId === "claim" ? (
            <>
              <PuckKicker>Step 3</PuckKicker>
              <PuckTitle>Connect this phone</PuckTitle>
              <PuckBody>Paste the setup code from your Mac once. It links this device to Puck.</PuckBody>
              {deviceLinked ? <PuckBody>This phone is already linked. Continue to preview the next steps.</PuckBody> : null}
              {!deviceLinked || devWalkthrough ? (
                <TextInput
                  value={claimCode}
                  onChangeText={(value) => {
                    setClaimCode(value);
                    setClaimError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Setup code"
                  placeholderTextColor="#a08b80"
                  style={styles.input}
                />
              ) : null}
              {claimError ? <PuckError>{claimError}</PuckError> : null}
              <PuckButton
                label={claimBusy ? "Connecting…" : deviceLinked && devWalkthrough ? "Continue" : "Connect phone"}
                onPress={() => void submitClaim()}
                disabled={claimBusy}
              />
              <PuckTextLink label="Sign out" onPress={() => void onSignOut()} />
            </>
          ) : null}

          {stepId === "notifications" ? (
            <>
              <PuckKicker>Almost there</PuckKicker>
              <PuckTitle>Allow notifications</PuckTitle>
              <PuckBody>Bots need to reach you when Puck is closed. Heads-up alerts land on this phone.</PuckBody>
              {notifyDenied ? <PuckError>Notifications are off. Turn them on in system settings, then tap again.</PuckError> : null}
              <PuckButton label="Turn on notifications" onPress={() => void allowNotifications()} />
              <PuckButton label="Skip for now" onPress={next} variant="ghost" style={styles.secondary} />
            </>
          ) : null}

          {stepId === "fullscreen" ? (
            <>
              <PuckKicker>Urgent alerts</PuckKicker>
              <PuckTitle>Lock-screen alerts</PuckTitle>
              <PuckBody>Urgent pages can take the screen over the lock, like an alarm. Android asks you to allow that separately.</PuckBody>
              {fullScreenOk === false ? <PuckError>Full-screen access is off. Open settings and allow Puck.</PuckError> : null}
              {fullScreenOk ? <PuckBody>Full-screen access is on.</PuckBody> : null}
              <PuckButton label="Open settings" onPress={() => void openFullScreen()} />
              <PuckButton label={fullScreenOk ? "Continue" : "Skip for now"} onPress={next} variant={fullScreenOk ? "coral" : "ghost"} style={styles.secondary} />
            </>
          ) : null}

          {stepId === "ready" ? (
            <>
              <PuckKicker>You're set</PuckKicker>
              <PuckTitle>Ready to be paged</PuckTitle>
              <PuckBody>Pair a bot with puck add, or send a test alert from your Mac. When something arrives, Puck takes over.</PuckBody>
              <PuckButton label="Start Puck" onPress={() => void finish()} />
            </>
          ) : null}
        </Animated.View>
      </ScrollView>
    </PuckScreen>
  );
}

function buildSteps(clerk: GateStatus, device: GateStatus): StepId[] {
  const steps: StepId[] = [];
  if (clerk === "out") {
    steps.push("welcome", "sign-in");
  }
  if (clerk === "in" && device === "out") {
    if (steps.length === 0) steps.push("welcome");
    steps.push("this-phone", "claim");
  } else if (clerk === "in" && device === "in") {
    steps.push("this-phone");
  }
  steps.push("notifications", "fullscreen", "ready");
  return steps;
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 24,
    paddingTop: 8,
  },
  input: {
    backgroundColor: puckColors.card,
    borderColor: puckColors.choiceBorder,
    borderRadius: 18,
    borderWidth: 2,
    color: puckColors.ink,
    fontFamily: puckFonts.extraBold,
    fontSize: 18,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: puckColors.choiceShadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  secondary: {
    marginTop: 12,
  },
});
