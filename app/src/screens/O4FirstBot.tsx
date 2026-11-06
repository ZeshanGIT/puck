/**
 * O4 Your first bot: how a bot gets in. The command to run on a computer signed in to Puck, a
 * waiting line, "Enter a code instead" (the old pairing screen as the fallback) and "I'll do it
 * later". Prototype: `SCREENS.firstbot` and the `.code` and `.cap` CSS.
 *
 * The pairing request showing up here by itself (B4) needs a pending-pairings query that the
 * backend does not have yet, so the waiting line stays a waiting line for now.
 */
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PairingScreen } from "../Pairing";
import { Caption, CopyIcon, HeroText, OnboardingFrame, WaitingLine } from "../onboarding/parts";
import { Btn } from "../ui/Btn";
import { useTheme } from "../ui/theme";

const COMMAND = "puck add sheldon --colour coral";

export function O4FirstBot({ onFinish }: { onFinish: () => void }) {
  const t = useTheme().tokens;
  const [entering, setEntering] = useState(false);

  if (entering) return <PairingScreen onClose={() => setEntering(false)} />;

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
        <Btn label="Enter a code instead" variant="line" onPress={() => setEntering(true)} />
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
