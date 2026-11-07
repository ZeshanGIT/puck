/**
 * S7 About: the Puck blob, its version, and the build and the backend it talks to. Dev builds add
 * their own rows (`devInfo`). Prototype: `SCREENS.about` (`vault/Projects/Puck/mockups/Puck
 * prototype.html`); `App screens.md` S7.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { OnboardingFrame } from "../onboarding/parts";
import { Blob } from "../ui/Blob";
import { SAMPLE_BOTS } from "../ui/blobShapes";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { KvRow, KvText, MAX_FONT_SCALE, NavBar } from "./PairingParts";
import { Section } from "./SettingsParts";

export interface S7AboutProps {
  /** "Puck 1.0.0" */
  title: string;
  /** "41 · debug" */
  build: string;
  /** The Convex deployment name. */
  backend: string;
  /** Extra rows for dev builds only. */
  devInfo?: readonly { label: string; value: string }[];
  onBack: () => void;
}

export function S7About({ title, build, backend, devInfo = [], onBack }: S7AboutProps) {
  const t = useTheme().tokens;
  return (
    <OnboardingFrame>
      <NavBar title="About" onBack={onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Blob bot={SAMPLE_BOTS.puck} size={72} />
          <Text accessibilityRole="header" testID="about-title" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: t.ink }]}>
            {title}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tagline, { color: t.ink2 }]}>
            A pager for your AI agents.
          </Text>
        </View>
        <View style={[styles.group, { backgroundColor: t.fill }]}>
          <KvRow label="Build" first>
            <KvText>{build}</KvText>
          </KvRow>
          <KvRow label="Backend">
            <KvText>{backend}</KvText>
          </KvRow>
        </View>
        {devInfo.length > 0 ? (
          <>
            <Section label="Developer" />
            <View style={[styles.group, styles.devGroup, { backgroundColor: t.fill }]}>
              {devInfo.map((row, index) => (
                <KvRow key={row.label} label={row.label} first={index === 0}>
                  <KvText mono>{row.value}</KvText>
                </KvRow>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  hero: { alignItems: "center", paddingHorizontal: 28, paddingTop: 10 },
  title: { fontFamily: fontFamily.black, fontSize: 24, fontWeight: "900", letterSpacing: 24 * -0.015, marginTop: 14 },
  tagline: { fontFamily: fontFamily.semiBold, fontSize: 16, marginTop: 6, textAlign: "center" },
  group: { marginTop: 20, marginHorizontal: 16, borderRadius: 18, overflow: "hidden" },
  devGroup: { marginTop: 4 },
});
