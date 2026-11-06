/**
 * O3 Test page: Puck pages this phone with an urgent test alert ("Can you hear me?") so the
 * first time he feels Puck is on purpose. Prototype: `SCREENS.test`.
 *
 * `alerts.sendTest({ clientId })` sends the alert. While it is pending for this client, the
 * existing alert screens show it here (a lock-screen page opens the app on this step). The step
 * is done once an alert that appeared has been answered and nothing is pending any more.
 */
import { anyApi } from "convex/server";
import { useConvex, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ChoiceScreen, type PendingAlert } from "../ChoiceScreen";
import { syncClientPushToken } from "../clientAuth";
import { HeroText, OnboardingFrame, WaitingLine } from "../onboarding/parts";
import { SwipeScreen } from "../SwipeScreen";
import { readableError } from "../session";
import { Banner } from "../ui/Banner";
import { Blob, type BlobHandle } from "../ui/Blob";
import { SAMPLE_BOTS } from "../ui/blobShapes";
import { Btn } from "../ui/Btn";
import { Toast, useToast } from "../ui/Toast";

type Send = "idle" | "sending" | "sent";

export function O3TestPage({ clientId, onContinue }: { clientId: string; onContinue: () => void }) {
  const client = useConvex();
  const toast = useToast();
  const blob = useRef<BlobHandle>(null);
  const pending = useQuery(anyApi.alerts.pending, { clientId }) as PendingAlert[] | undefined;
  const [send, setSend] = useState<Send>("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const sawAlert = useRef(false);

  // Make sure this client can be pushed to, if notifications are on.
  useEffect(() => {
    syncClientPushToken(client, clientId).catch((caught: unknown) => console.error(readableError(caught)));
  }, [client, clientId]);

  const alert = pending?.[0];
  useEffect(() => {
    if (alert) {
      sawAlert.current = true;
    } else if (pending !== undefined && sawAlert.current && !done) {
      sawAlert.current = false;
      setDone(true);
    }
  }, [alert, pending, done]);

  useEffect(() => {
    if (done) blob.current?.hop();
    else blob.current?.arrive();
  }, [done]);

  async function sendTest() {
    setSend("sending");
    setError(null);
    try {
      await client.mutation(anyApi.alerts.sendTest, { clientId });
      setSend("sent");
      toast.show("Lock your phone now…");
    } catch (caught) {
      setSend("idle");
      setError(readableError(caught));
    }
  }

  // The test page (or any alert for this client) is on screen: answer it here.
  if (alert && !done) {
    return alert.presentation === "swipe" ? (
      <SwipeScreen alert={alert} waiting={pending?.length ?? 1} />
    ) : (
      <ChoiceScreen alert={alert} waiting={pending?.length ?? 1} />
    );
  }

  return (
    <OnboardingFrame>
      <View style={styles.hero}>
        <Blob ref={blob} bot={SAMPLE_BOTS.puck} size={112} live />
        {done ? (
          <HeroText title="It works" body="That's how an urgent page feels. Normal ones are a gentle notification." />
        ) : (
          <HeroText
            title="Try a test page"
            body="Lock your phone after tapping below. Puck will ring you in a few seconds, so you know what it feels like."
          />
        )}
        {send === "sent" && !done ? <WaitingLine>Waiting for your answer…</WaitingLine> : null}
      </View>
      <View style={styles.bottom}>
        {error ? <Banner message={error} action={{ label: "Try again", onPress: () => void sendTest() }} /> : null}
        <View style={styles.buttons}>
          {done ? (
            <Btn label="Continue" onPress={onContinue} />
          ) : (
            <>
              <Btn
                label={send === "sending" ? "Sending…" : send === "sent" ? "Send again" : "Send a test page"}
                onPress={() => void sendTest()}
                disabled={send === "sending"}
              />
              <Btn label="Skip" variant="ghost" onPress={onContinue} />
            </>
          )}
        </View>
      </View>
      <Toast message={toast.message} visible={toast.visible} />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  bottom: { paddingBottom: 8 },
  buttons: { paddingHorizontal: 20, gap: 4, paddingTop: 8 },
});
