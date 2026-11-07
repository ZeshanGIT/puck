/**
 * Dev builds only: the small menu that replaces the old dev links in the onboarding flow.
 * Reached from O1's "Dev menu" and `puck://dev-menu`. "Dev: setup code (old claim)" is the old
 * device-claim screen (it still talks to `/device/claim`); it is no longer part of the normal path.
 */
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { convexSiteUrl } from "../deployment";
import { saveDeviceSecret } from "../deviceStore";
import { claimDevice, readableError } from "../session";
import { Banner } from "../ui/Banner";
import { Btn } from "../ui/Btn";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { HeroText, OnboardingFrame } from "./parts";

export function DevMenu({
  onClose,
  onWalkThrough,
  onDesignGallery,
  onSignOut,
}: {
  onClose: () => void;
  onWalkThrough: () => void;
  onDesignGallery: () => void;
  onSignOut: () => void;
}) {
  const [screen, setScreen] = useState<"menu" | "setup-code">("menu");
  if (screen === "setup-code") return <DevSetupCode onBack={() => setScreen("menu")} />;
  return (
    <OnboardingFrame>
      <HeroText left title="Dev menu" body="Dev builds only." />
      <View style={styles.list}>
        <Btn label="Dev: walk through every step" variant="line" onPress={onWalkThrough} />
        <Btn label="Dev: design gallery" variant="line" onPress={onDesignGallery} />
        <Btn label="Dev: setup code (old claim)" variant="line" onPress={() => setScreen("setup-code")} />
        <Btn label="Sign out" variant="line" onPress={onSignOut} />
      </View>
      <View style={styles.spacer} />
      <View style={styles.bottom}>
        <Btn label="Close" variant="ghost" onPress={onClose} />
      </View>
    </OnboardingFrame>
  );
}

function DevSetupCode({ onBack }: { onBack: () => void }) {
  const t = useTheme().tokens;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setMessage(null);
    try {
      const claimed = await claimDevice(convexSiteUrl, code);
      await saveDeviceSecret(claimed.secret);
      setMessage("Claimed. The secret is stored, but the app no longer signs in with it.");
    } catch (caught) {
      setMessage(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingFrame>
      <HeroText left title="Setup code" body="The old claim: paste the setup code from your Mac." />
      <View style={styles.list}>
        <TextInput
          maxFontSizeMultiplier={1.3}
          value={code}
          onChangeText={(value) => {
            setCode(value);
            setMessage(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Setup code"
          placeholderTextColor={t.ink3}
          style={[styles.input, { backgroundColor: t.fill, color: t.ink }]}
        />
        <Btn label={busy ? "Connecting…" : "Claim"} onPress={() => void claim()} disabled={busy || code.trim().length === 0} />
      </View>
      {message ? <Banner tone="quiet" message={message} /> : null}
      <View style={styles.spacer} />
      <View style={styles.bottom}>
        <Btn label="Back" variant="ghost" onPress={onBack} />
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, gap: 12, paddingTop: 8 },
  spacer: { flex: 1 },
  bottom: { paddingHorizontal: 20, paddingBottom: 8 },
  input: { borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fontFamily.extraBold, fontSize: 18 },
});
