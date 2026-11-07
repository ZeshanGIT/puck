/**
 * Runs the pairing flow, J2: B3 (type a code) or B4 (a request) first, then B5 (meet the bot).
 *
 * - Opened from a tap on the pairing notification (N7) or the PAIRING card on Home: B4 for that bot,
 *   with the code shown to check against the terminal.
 * - Opened from "Pair a bot": B3. The sixth digit looks for a waiting request with that code: found,
 *   B4 (no code shown, he typed it); not found (a CLI that is not signed in has no request on the
 *   account to look up), approved straight away, as typing the code always did.
 * - Approve goes to B5; Reject tells the terminal and closes.
 *
 * The host takes a `PairingSource` (the requests, approve, reject) so the same flow runs on Convex
 * (`ConnectedPairingHost`) and on fake data in the dev gallery.
 */
import { anyApi } from "convex/server";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { OnboardingFrame } from "../onboarding/parts";
import { clearPairingNotification } from "../pairingDisplay";
import {
  botNameFromId,
  findRequestByBotId,
  findRequestByCode,
  pairingErrorText,
  requestLook,
  type PairingRequest,
} from "../pairingModel";
import { readableError } from "../session";
import type { BlobBot } from "../ui/blobShapes";
import { botLook } from "../ui/botLook";
import { Btn } from "../ui/Btn";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { usePairingRequests } from "../usePairingRequests";
import { B3PairCode } from "./B3PairCode";
import { B4Approve } from "./B4Approve";
import { B5Meet } from "./B5Meet";
import { NavBar } from "./PairingParts";

export interface PairingSource {
  /** The open requests; undefined while they load. */
  requests: readonly PairingRequest[] | undefined;
  /** Approves with this code; resolves with the bot's id. Rejects with an Error on a wrong or expired code. */
  approve: (pairingCode: string) => Promise<{ botId: string }>;
  reject: (botId: string) => Promise<void>;
}

/** Where the flow starts. */
export type PairingStart =
  | { kind: "code" }
  | { kind: "approve"; botId: string }
  | { kind: "meet"; bot: BlobBot };

type Step =
  | { kind: "code" }
  | { kind: "approve"; botId: string; showCode: boolean }
  | { kind: "meet"; bot: BlobBot };

export interface PairingHostProps {
  source: PairingSource;
  start: PairingStart;
  /** The flow is over (Done, Reject, Back). `message` is a line for a Toast on the screen underneath. */
  onClose: (message?: string) => void;
  /** A bot was approved and he pressed Done on B5 (called just before `onClose`). */
  onPaired?: () => void;
}

/** Re-reads the clock so "Expires in 9 min" and the expiry of a request follow it. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PairingHost({ source, start, onClose, onPaired }: PairingHostProps) {
  const now = useNow(15_000);
  const [step, setStep] = useState<Step>(() =>
    start.kind === "approve" ? { kind: "approve", botId: start.botId, showCode: true } : start,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A typed code waits here until the list of requests is known, so a request is never skipped by being early.
  const [typed, setTyped] = useState<string | null>(null);
  const { requests, approve, reject } = source;
  // The request B4 shows stays on screen while it is being approved, after it has left the list.
  const shown = useRef<PairingRequest | null>(null);

  // Android's back gesture does what the Back control does.
  // From B4 reached by typing, Back returns to the keypad; otherwise it closes the flow.
  const typedApprove = step.kind === "approve" && !step.showCode;
  const goBack = useCallback(() => {
    if (busy) return;
    if (typedApprove) {
      setError(null);
      setStep({ kind: "code" });
      return;
    }
    onClose();
  }, [busy, onClose, typedApprove]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [goBack]);

  const onCode = useCallback((code: string) => {
    setError(null);
    setTyped(code);
  }, []);

  useEffect(() => {
    if (typed === null || requests === undefined || step.kind !== "code") return;
    const code = typed;
    const match = findRequestByCode(requests, code, Date.now());
    setTyped(null);
    if (match) {
      shown.current = match;
      setStep({ kind: "approve", botId: match.botId, showCode: false });
      return;
    }
    setBusy(true);
    approve(code)
      .then((result) => {
        void clearPairingNotification(result.botId);
        setStep({ kind: "meet", bot: botLook({ botId: result.botId, botName: botNameFromId(result.botId) }) });
      })
      .catch((caught: unknown) => setError(pairingErrorText(readableError(caught))))
      .finally(() => setBusy(false));
  }, [typed, requests, step.kind, approve]);

  if (step.kind === "code") {
    // A typed code on a signed-in phone waits for the list; show the keypad as busy meanwhile.
    return (
      <B3PairCode
        error={error}
        busy={busy || typed !== null}
        onSubmit={onCode}
        onEdit={() => setError(null)}
        onBack={goBack}
      />
    );
  }

  if (step.kind === "meet") {
    return (
      <B5Meet
        bot={step.bot}
        onDone={() => {
          onPaired?.();
          onClose();
        }}
      />
    );
  }

  const found = requests === undefined ? null : findRequestByBotId(requests, step.botId, now);
  if (found) shown.current = found;
  const request = found ?? (busy ? shown.current : null);

  if (requests === undefined && shown.current === null) return <Loading onBack={goBack} />;
  if (request === null) return <NoLongerOpen onBack={goBack} />;

  const decide = (action: "approve" | "reject") => {
    setError(null);
    setBusy(true);
    const run =
      action === "approve"
        ? approve(request.pairingCode).then(() => {
            void clearPairingNotification(request.botId);
            setStep({ kind: "meet", bot: requestLook(request) });
          })
        : reject(request.botId).then(() => {
            void clearPairingNotification(request.botId);
            onClose("Rejected. The terminal was told.");
          });
    run.catch((caught: unknown) => setError(pairingErrorText(readableError(caught)))).finally(() => setBusy(false));
  };

  return (
    <B4Approve
      request={request}
      showCode={step.showCode}
      now={now}
      busy={busy}
      error={error}
      onApprove={() => decide("approve")}
      onReject={() => decide("reject")}
      onBack={goBack}
    />
  );
}

/** The request this screen was opened for is not on the list (answered elsewhere, or timed out). */
function NoLongerOpen({ onBack }: { onBack: () => void }) {
  const t = useTheme().tokens;
  return (
    <OnboardingFrame>
      <NavBar onBack={onBack} />
      <View style={styles.gone}>
        <GoneText title="That request is no longer open" body="It was handled already, or it timed out. Run puck add again." colour={[t.ink, t.ink2]} />
      </View>
      <View style={styles.bottom}>
        <Btn label="Back" variant="line" onPress={onBack} />
      </View>
    </OnboardingFrame>
  );
}

function Loading({ onBack }: { onBack: () => void }) {
  return (
    <OnboardingFrame>
      <NavBar onBack={onBack} />
    </OnboardingFrame>
  );
}

function GoneText({ title, body, colour }: { title: string; body: string; colour: [string, string] }) {
  return (
    <View style={styles.goneText}>
      <Text accessibilityRole="header" style={{ color: colour[0], fontFamily: fontFamily.black, fontSize: 24, textAlign: "center" }}>
        {title}
      </Text>
      <Text style={{ color: colour[1], fontFamily: fontFamily.semiBold, fontSize: 15.5, textAlign: "center", marginTop: 8 }}>
        {body}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------- connected */

/** The pairing flow on Convex: the account's requests, `bots.approvePairing`, `bots.rejectPairing`. */
export function ConnectedPairingHost({
  clientId,
  start,
  onClose,
  onPaired,
}: {
  /** This install's client id; null on the legacy device path (no request list, typed codes only). */
  clientId: string | null | undefined;
  start: PairingStart;
  onClose: (message?: string) => void;
  onPaired?: () => void;
}) {
  const requests = usePairingRequests(clientId);
  const approveMutation = useMutation(anyApi.bots.approvePairing);
  const rejectMutation = useMutation(anyApi.bots.rejectPairing);
  const source = useMemo<PairingSource>(
    () => ({
      // With no client id the legacy device path has no list: the typed code is approved directly.
      requests: clientId === null ? [] : requests,
      approve: async (pairingCode) => {
        const result = (await approveMutation(clientId ? { pairingCode, clientId } : { pairingCode })) as {
          botId?: unknown;
        };
        if (typeof result.botId !== "string" || result.botId.length === 0) {
          throw new Error("pairing did not return a bot id");
        }
        return { botId: result.botId };
      },
      reject: async (botId) => {
        if (!clientId) throw new Error("Sign in again to reject a request");
        await rejectMutation({ clientId, botId });
      },
    }),
    [approveMutation, rejectMutation, clientId, requests],
  );
  return <PairingHost source={source} start={start} onClose={onClose} onPaired={onPaired} />;
}

const styles = StyleSheet.create({
  gone: { flex: 1, justifyContent: "center" },
  goneText: { paddingHorizontal: 28 },
  bottom: { paddingHorizontal: 20, paddingBottom: 14 },
});
