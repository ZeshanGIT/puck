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
import { useEffect, useReducer, useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { PendingAlert } from "../ChoiceScreen";
import { syncClientFullScreen, syncClientPushToken } from "../clientAuth";
import { HeroText, OnboardingFrame, WaitingLine } from "../onboarding/parts";
import { readableError } from "../session";
import { testPage } from "../testPageMachine";
import { Banner } from "../ui/Banner";
import { Blob, type BlobHandle } from "../ui/Blob";
import { SAMPLE_BOTS } from "../ui/blobShapes";
import { Btn } from "../ui/Btn";
import { Toast, useToast } from "../ui/Toast";
import { AlertHost } from "./AlertHost";

/** Seconds between tapping Send and the page, so the phone can be locked first (App screens O3). */
const LOCK_DELAY_SECONDS = 10;

export function O3TestPage({ clientId, onContinue }: { clientId: string; onContinue: () => void }) {
  const client = useConvex();
  const toast = useToast();
  const blob = useRef<BlobHandle>(null);
  // Test pages left from an earlier try are cancelled first, so one never greets the person
  // before they tap Send. The pending query waits for that.
  const [{ cleared, send, error, done }, dispatch] = useReducer(testPage.transition, testPage.initial);
  const pending = useQuery(anyApi.alerts.pending, cleared ? { clientId } : "skip") as PendingAlert[] | undefined;

  useEffect(() => {
    let alive = true;
    client
      .mutation(anyApi.alerts.cancelTests, { clientId })
      .catch((caught: unknown) => console.error(readableError(caught)))
      .finally(() => {
        if (alive) dispatch({ type: "clearedOldPages" });
      });
    return () => {
      alive = false;
    };
  }, [client, clientId]);

  // Make sure this client can be pushed to, if notifications are on.
  useEffect(() => {
    syncClientPushToken(client, clientId).catch((caught: unknown) => console.error(readableError(caught)));
    syncClientFullScreen(client, clientId).catch((caught: unknown) => console.error(readableError(caught)));
  }, [client, clientId]);

  const alert = pending?.[0];
  useEffect(() => {
    dispatch({ type: "alertsChanged", hasAlert: alert !== undefined, loaded: pending !== undefined });
  }, [alert, pending]);

  useEffect(() => {
    if (done) blob.current?.hop();
    else blob.current?.arrive();
  }, [done]);

  async function sendTest(delaySeconds: number) {
    dispatch({ type: "sendStarted" });
    try {
      await client.mutation(anyApi.alerts.sendTest, { clientId, delaySeconds });
      dispatch({ type: "sendSucceeded" });
      if (delaySeconds > 0) toast.show(`Lock your phone now. Paging you in ${delaySeconds} seconds.`);
    } catch (caught) {
      dispatch({ type: "sendFailed", message: readableError(caught) });
    }
  }

  // The test page (or any alert for this client) is on screen: answer it here.
  if (alert && !done) {
    return <AlertHost alert={alert} waiting={pending?.length ?? 1} />;
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
            body={`Tap below, then lock your phone. Puck will page you ${LOCK_DELAY_SECONDS} seconds later, so you know what it feels like.`}
          />
        )}
        {send === "sent" && !done ? <WaitingLine>Waiting for your answer…</WaitingLine> : null}
      </View>
      <View style={styles.bottom}>
        {error ? <Banner message={error} action={{ label: "Try again", onPress: () => void sendTest(LOCK_DELAY_SECONDS) }} /> : null}
        <View style={styles.buttons}>
          {done ? (
            <Btn label="Continue" onPress={onContinue} />
          ) : (
            <>
              <Btn
                label={send === "sending" ? "Sending…" : send === "sent" ? "Send again" : "Send a test page"}
                onPress={() => void sendTest(LOCK_DELAY_SECONDS)}
                disabled={send === "sending"}
              />
              <Btn label="Test without locking" variant="line" onPress={() => void sendTest(0)} disabled={send === "sending"} />
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
