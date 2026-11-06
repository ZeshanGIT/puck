/**
 * Dev gallery for `Btn` and `ArmTimer`: every variant unarmed, armed (still),
 * and armed live through tap twice, plus a disabled row. Registered in
 * `DevGallery.tsx` by the orchestrator.
 */
import { type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Btn, type BtnVariant } from "../../ui/Btn";
import type { ThemeBot } from "../../ui/botTheme";
import { useTheme } from "../../ui/theme";
import { fontFamily, typeScale } from "../../ui/tokens";
import { TapTwiceGroup } from "../../ui/useTapTwice";

const VARIANTS: readonly { variant: BtnVariant; label: string; armedLabel: string }[] = [
  { variant: "primary", label: "Continue", armedLabel: "Tap again to continue" },
  { variant: "bot", label: "Approve", armedLabel: "Tap again to approve" },
  { variant: "line", label: "Not now", armedLabel: "Tap again to skip" },
  { variant: "danger", label: "Cancel this alert", armedLabel: "Tap again to cancel" },
  { variant: "ghost", label: "Reject", armedLabel: "Tap again to reject" },
];

const BOTS: readonly { name: string; bot: ThemeBot }[] = [
  { name: "coral", bot: { colour: "coral" } },
  { name: "mustard (ink text)", bot: { colour: "mustard" } },
  { name: "sky", bot: { colour: "sky" } },
  { name: "black", bot: { colour: "black" } },
];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const { tokens: t } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[typeScale.sectionHeader, { color: t.ink3 }]}>{title}</Text>
      {note ? <Text style={[styles.note, { color: t.ink2 }]}>{note}</Text> : null}
      <View style={styles.stack}>{children}</View>
    </View>
  );
}

function Caption({ children }: { children: string }) {
  const { tokens: t } = useTheme();
  return <Text style={[styles.caption, { color: t.ink3 }]}>{children}</Text>;
}

export function BtnGallery() {
  const { tokens: t } = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: t.ink }]}>Btn</Text>

      <Section title="Unarmed">
        {VARIANTS.map((v) => (
          <Btn key={v.variant} variant={v.variant} label={`${v.label}  (${v.variant})`} onPress={() => {}} />
        ))}
      </Section>

      <Section title="Armed, still" note="A fixed full bar, as under reduced motion.">
        {VARIANTS.map((v) => (
          <Btn
            key={v.variant}
            variant={v.variant}
            label={v.label}
            armed
            armedLabel={v.armedLabel}
          />
        ))}
      </Section>

      <Section
        title="Armed, live"
        note="Tap once to arm: the bar drains over 4 s, then it disarms. Tap again to confirm. Arming one disarms the others."
      >
        <LiveRows />
      </Section>

      <Section title="Bot variant, other bots" note="Unarmed, armed (still), live.">
        <TapTwiceGroup>
          {BOTS.map(({ name, bot }) => (
            <View key={name} style={styles.botBlock}>
              <Caption>{name}</Caption>
              <Btn variant="bot" bot={bot} label="Approve" onPress={() => {}} />
              <Btn variant="bot" bot={bot} label="Approve" armed armedLabel="Tap again to approve" />
              <Btn
                variant="bot"
                bot={bot}
                label="Approve"
                tapTwice={{ onConfirm: () => {}, armedLabel: "Tap again to approve" }}
              />
            </View>
          ))}
        </TapTwiceGroup>
      </Section>

      <Section title="Disabled">
        {VARIANTS.map((v) => (
          <Btn key={v.variant} variant={v.variant} label={v.label} disabled onPress={() => {}} />
        ))}
      </Section>
    </ScrollView>
  );
}

function LiveRows() {
  return (
    <TapTwiceGroup>
      {VARIANTS.map((v) => (
        <Btn
          key={v.variant}
          variant={v.variant}
          label={v.label}
          tapTwice={{ onConfirm: () => {}, armedLabel: v.armedLabel }}
        />
      ))}
    </TapTwiceGroup>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 60 },
  title: { fontFamily: fontFamily.black, fontSize: 30, fontWeight: "900", marginBottom: 8 },
  section: { marginTop: 24 },
  note: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
  },
  stack: { marginTop: 12, gap: 16 },
  botBlock: { gap: 14 },
  caption: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    fontWeight: "700",
  },
});
