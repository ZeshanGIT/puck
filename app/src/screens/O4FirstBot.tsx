/**
 * O4 Your first bot: how a bot gets in. The command to run on a computer signed in to Puck, a
 * waiting line, "Enter a code instead" (the old pairing screen as the fallback) and "I'll do it
 * later". Prototype: `SCREENS.firstbot` and the `.code` and `.cap` CSS.
 *
 * The pairing request shows up here by itself: when `bots.pairingRequests` has one, B4 opens over
 * this screen (a request he backed out of stays off it); approving it ends onboarding at B5's Done.
 * "Enter a code instead" is B3, the typed-code fallback (a CLI that is not signed in).
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { readClientId } from "../clientStore";
import { ConnectedPairingHost, type PairingStart } from "./PairingHost";
import { usePairingRequests } from "../usePairingRequests";
import { Caption, CopyIcon, HeroText, OnboardingFrame, WaitingLine } from "../onboarding/parts";
import { Btn } from "../ui/Btn";
import { useTheme } from "../ui/theme";

const COMMAND = "puck add sheldon --colour coral";

export function O4FirstBot({ onFinish }: { onFinish: () => void }) {
  const t = useTheme().tokens;
  // undefined while the stored client id loads; null when this install has none (typed codes only).
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    readClientId()
      .then(setClientId)
      .catch(() => setClientId(null));
  }, []);
  const requests = usePairingRequests(clientId);
  const [flow, setFlow] = useState<PairingStart | null>(null);
  // Requests he has already looked at and backed out of, so they do not open again by themselves.
  const dismissed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (flow !== null || !requests) return;
    const next = requests.find((request) => !dismissed.current.has(request.botId));
    if (next) setFlow({ kind: "approve", botId: next.botId });
  }, [flow, requests]);

  if (flow) {
    return (
      <ConnectedPairingHost
        clientId={clientId}
        start={flow}
        onPaired={onFinish}
        onClose={() => {
          if (flow.kind === "approve") dismissed.current.add(flow.botId);
          else for (const request of requests ?? []) dismissed.current.add(request.botId);
          setFlow(null);
        }}
      />
    );
  }

  return (
    <OnboardingFrame>
      <HeroText left title="Bring in your first bot" body="On a computer signed in to Puck, run:" />
      <View style={[styles.code, { backgroundColor: t.fill }]}>
        <Text selectable style={[styles.command, { color: t.ink }]}>
          {COMMAND}
        </Text>
        <CopyIcon colour={t.ink2} />
      </View>
      <Caption>The request shows up here on its own. You'll check a six-digit code and approve it.</Caption>
      <WaitingLine>Waiting for a bot…</WaitingLine>
      <View style={styles.spacer} />
      <View style={styles.bottom}>
        <Btn label="Enter a code instead" variant="line" onPress={() => setFlow({ kind: "code" })} />
        <Btn label="I'll do it later" variant="ghost" onPress={onFinish} />
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  code: {
    marginHorizontal: 22,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  command: { fontFamily: "monospace", fontWeight: "700", fontSize: 14.5, flexShrink: 1 },
  spacer: { flex: 1 },
  bottom: { paddingHorizontal: 20, paddingBottom: 8, gap: 4 },
});
