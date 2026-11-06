/**
 * O1 Welcome: what Puck is, and Continue with Google. After sign-in the phone registers itself
 * silently as a client under its model name; this screen also carries the states of that step:
 * a same-name client ("Replace "Pixel 7"?", Q11) and a failure with Retry.
 * Prototype: `SCREENS.welcome` (132 dp live Puck blob, 34 / 900 title, 17 / 600 line, one button).
 */
import type { ClerkAccount } from "@puck/shared";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ClientSession } from "../clientAuth";
import { OnboardingFrame, HeroText } from "../onboarding/parts";
import { useGoogleSignIn } from "../onboarding/googleSignIn";
import { Banner } from "../ui/Banner";
import { Blob, type BlobHandle } from "../ui/Blob";
import { SAMPLE_BOTS } from "../ui/blobShapes";
import { Btn } from "../ui/Btn";
import { Sheet, SheetOption, SheetText, SheetTitle } from "../ui/Sheet";

export function O1Welcome({
  session,
  signedIn,
  onSignedIn,
  onContinue,
  onOpenDevMenu,
}: {
  session: ClientSession;
  /** Signed in with Clerk. Registration then runs behind this screen, with the button busy. */
  signedIn: boolean;
  onSignedIn: (account: ClerkAccount) => Promise<void>;
  onContinue: () => void;
  onOpenDevMenu?: () => void;
}) {
  const blob = useRef<BlobHandle>(null);
  const google = useGoogleSignIn(onSignedIn);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    blob.current?.arrive();
  }, []);

  const conflict = session.status === "conflict" ? session : null;
  const conflictBusy = conflict?.busy === true;
  const conflictWaiting = conflict !== null && !conflictBusy;
  useEffect(() => {
    setSheetOpen(conflictWaiting);
  }, [conflictWaiting]);

  // Only the dev walkthrough shows O1 to someone who is signed in and registered: a plain Continue.
  const showContinue = signedIn && session.status === "ready";
  const busy = google.busy || conflictBusy || (signedIn && session.status === "pending");

  return (
    <OnboardingFrame>
      <View style={styles.hero}>
        <Blob ref={blob} bot={SAMPLE_BOTS.puck} size={132} live />
        <HeroText title="Puck" titleSize={34} bodySize={17} body={"Your bots page you here.\nYou answer, they hear back."} />
      </View>

      <View style={styles.bottom}>
        {google.error ? (
          <Banner message={google.error} action={{ label: "Try again", onPress: () => void google.start() }} />
        ) : null}
        {session.status === "error" ? (
          <Banner message={session.message} action={{ label: "Retry", onPress: session.retry }} />
        ) : null}
        {conflictWaiting && !sheetOpen ? (
          <Banner
            message={`A client called “${conflict.name}” is already on your account.`}
            action={{ label: "Choose", onPress: () => setSheetOpen(true) }}
          />
        ) : null}
        <View style={styles.button}>
          <Btn
            label={showContinue ? "Continue" : busy ? "Signing in…" : "Continue with Google"}
            onPress={showContinue ? onContinue : () => void google.start()}
            disabled={busy}
          />
          {__DEV__ && onOpenDevMenu ? <Btn label="Dev menu" variant="ghost" onPress={onOpenDevMenu} /> : null}
        </View>
      </View>

      <Sheet visible={sheetOpen && conflictWaiting} onClose={() => setSheetOpen(false)}>
        <SheetTitle>{conflict ? `Replace “${conflict.name}”?` : "Replace?"}</SheetTitle>
        <SheetText>
          {conflict
            ? `This account already has a client called “${conflict.name}”. Replacing it removes the old one and its push token. Or keep both as “${conflict.name} (2)”.`
            : ""}
        </SheetText>
        <SheetOption
          label="Replace"
          onPress={() => {
            setSheetOpen(false);
            conflict?.replace();
          }}
        />
        <SheetOption
          label="Use another name"
          detail={conflict ? `${conflict.name} (2)` : undefined}
          onPress={() => {
            setSheetOpen(false);
            conflict?.useAnotherName();
          }}
        />
      </Sheet>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  bottom: { paddingBottom: 18 },
  button: { paddingHorizontal: 20, gap: 4, paddingTop: 8 },
});
