/**
 * Gallery for the small UI pieces: Toast, Sheet, Pill, Chip, Banner, Group,
 * Row and NeedCard, each in its states. Renders with whatever theme the
 * surrounding ThemeProvider sets, so it can sit in a light or dark block of
 * the dev gallery. Sample strings come from the prototype.
 */
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Banner } from "../../ui/Banner";
import { Chip } from "../../ui/Chip";
import { type ThemeBot } from "../../ui/botTheme";
import { Group } from "../../ui/Group";
import { NeedCard } from "../../ui/NeedCard";
import { Pill } from "../../ui/Pill";
import { Row } from "../../ui/Row";
import { Sheet, SheetOption, SheetOptionIcon, SheetText, SheetTitle } from "../../ui/Sheet";
import { useBotTheme, useTheme } from "../../ui/theme";
import { Toast, useToast } from "../../ui/Toast";
import { fontFamily } from "../../ui/tokens";

/** Paths copied from the prototype's `ICON` object. */
const ICON = {
  alarm: "M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 20a1.9 1.9 0 0 0 3.4 0",
  sound: "M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  check: "M5 12.5l4.5 4.5L19 7.5",
  user: "M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0",
  phone: "M6 2.5h12a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 19V5A2.5 2.5 0 0 1 6 2.5z",
  snooze: "M12 13m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 9v4l2.5 2.5M5 3L2 6M19 3l3 3",
  warn: "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
} as const;

function Glyph({ d, size, colour, width = 2.2 }: { d: string; size: number; colour: string; width?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={d}
        fill="none"
        stroke={colour}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme().tokens;
  return (
    <View style={{ marginBottom: 8 }}>
      <Text
        accessibilityRole="header"
        style={{
          color: t.ink3,
          fontFamily: fontFamily.black,
          fontSize: 12.5,
          letterSpacing: 1,
          textTransform: "uppercase",
          paddingHorizontal: 22,
          paddingTop: 22,
          paddingBottom: 6,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function DemoButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme().tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.demoButton,
        { backgroundColor: pressed ? t.fill2 : t.fill },
      ]}
    >
      <Text style={{ color: t.ink, fontFamily: fontFamily.extraBold, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

const SAMPLE_BOT: ThemeBot = { colour: "coral" };
const MUTE_OPTIONS = ["Off", "For 1 hour", "Until tomorrow", "Until I turn it off"];

export function SmallComponentsGallery() {
  const t = useTheme().tokens;
  const bot = useBotTheme(SAMPLE_BOT);
  const toast = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mute, setMute] = useState("Off");
  const [needPressed, setNeedPressed] = useState(0);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Toast">
          <View style={styles.padded}>
            <DemoButton label="Show toast" onPress={() => toast.show("Not sent. Answer again when you're ready")} />
          </View>
        </Section>

        <Section title="Sheet">
          <View style={styles.padded}>
            <DemoButton label="Open sheet" onPress={() => setSheetOpen(true)} />
          </View>
        </Section>

        <Section title="Pills">
          <View style={[styles.padded, styles.row]}>
            <Pill icon={<Glyph d={ICON.sound} size={14} colour={t.ink2} width={2.2} />}>Reading aloud</Pill>
            <Pill urgent icon={<Glyph d={ICON.alarm} size={14} colour={t.danger} width={2.2} />}>
              Urgent
            </Pill>
          </View>
        </Section>

        <Section title="Chips">
          <View style={[styles.padded, styles.row]}>
            {MUTE_OPTIONS.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={mute === option}
                onPress={() => setMute(option)}
              />
            ))}
          </View>
        </Section>

        <Section title="Banners">
          <Banner
            message="Notifications are off, so bots can't reach you while Puck is closed."
            action={{ label: "Turn on", onPress: () => toast.show("Notifications on") }}
          />
          <Banner message="You're offline. Answers wait on this phone and send when you're back." />
          <Banner
            tone="quiet"
            message="Sheldon is muted for 1 hour."
            action={{ label: "Unmute", onPress: () => toast.show("Sheldon unmuted") }}
          />
        </Section>

        <Section title="Rows in a group">
          <Group>
            <Row
              title="zeshan.nandan@gmail.com"
              leading={<IconTile d={ICON.user} />}
            />
            <Row
              title="This phone"
              value="Pixel 7"
              leading={<IconTile d={ICON.phone} />}
              chevron
              onPress={() => toast.show("Opens This phone")}
            />
            <Row
              title="Alert health"
              value="All good"
              chevron
              onPress={() => toast.show("Opens Alert health")}
            />
          </Group>
          <View style={{ height: 8 }} />
          <Group>
            <Row
              title="Sheldon"
              subtitle="Ship the 0.3 build tonight?"
              time="9:12"
              tag={{ label: "URGENT", urgent: true }}
              detail="Answer delivered"
              detailTone="ok"
              detailIcon={<Glyph d={ICON.check} size={14} colour={t.ok} width={2.6} />}
              leading={<View style={[styles.dot, { backgroundColor: bot.bot }]} />}
              onPress={() => toast.show("Opens Sheldon")}
            />
            <Row
              title="Sheldon"
              subtitle="Last paged 9:12"
              detail="Muted for 1 hour"
              leading={<View style={[styles.dot, { backgroundColor: bot.bot }]} />}
            />
          </Group>
        </Section>

        <Section title="Need card">
          <View style={styles.padded}>
            <NeedCard
              bot={SAMPLE_BOT}
              name="Sheldon"
              question="Ship the 0.3 build tonight?"
              time="now"
              tag={{ label: "URGENT", urgent: true }}
              urgent
              meta="From MacBook"
              leading={<View style={[styles.dot, { backgroundColor: bot.bot }]} />}
              onPress={() => setNeedPressed((n) => n + 1)}
            />
            <View style={{ height: 12 }} />
            <NeedCard
              bot={SAMPLE_BOT}
              name="Sheldon"
              question="Which of these should I tidy up?"
              time="2 min"
              meta="Not sent yet"
              metaWarn
              metaIcon={<Glyph d={ICON.warn} size={14} colour={t.warn} width={2.3} />}
              leading={<View style={[styles.dot, { backgroundColor: bot.bot }]} />}
              onPress={() => setNeedPressed((n) => n + 1)}
            />
            <Text style={{ color: t.ink3, fontFamily: fontFamily.bold, fontSize: 13.5, marginTop: 10 }}>
              Taps on the cards: {needPressed}
            </Text>
          </View>
        </Section>
      </ScrollView>

      <Toast message={toast.message} visible={toast.visible} />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <SheetTitle>Snooze</SheetTitle>
        <SheetText>It waits under Waiting. Sheldon will know you snoozed.</SheetText>
        <SheetOption
          label="5 minutes"
          icon={<SheetOptionIcon d={ICON.snooze} />}
          onPress={() => setSheetOpen(false)}
        />
        <SheetOption
          label="10 minutes"
          icon={<SheetOptionIcon d={ICON.snooze} />}
          onPress={() => setSheetOpen(false)}
        />
        <SheetOption
          label="Until I'm back"
          detail="No reminder"
          icon={<SheetOptionIcon d={ICON.snooze} />}
          onPress={() => setSheetOpen(false)}
        />
      </Sheet>
    </View>
  );
}

/** `.gi`: 34 dp tile with an 18 dp icon, for the leading slot of a row. */
function IconTile({ d }: { d: string }) {
  const t = useTheme().tokens;
  return (
    <View style={[styles.tile, { backgroundColor: t.card }]}>
      <Glyph d={d} size={18} colour={t.ink} width={2.1} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  padded: {
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  demoButton: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  dot: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
