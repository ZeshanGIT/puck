/**
 * B2 Bot detail: one bot's settings. Mute (stored on the backend as `mutedUntil`), whether it may
 * come through Do Not Disturb and silent mode (stored on the phone, Protocol changes section 6),
 * its Sound rows (Android's own settings for the channel), its colour, the details, and Remove with
 * tap twice. Prototype: `SCREENS.bot` and the `.chips`, `.swatches`, `.kv` CSS
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` B2.
 *
 * `B2Bot` only draws: it is given the bot and what changes. The choices behind it are `botsModel.ts`.
 */
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { PALETTE } from "../ui/botTheme";
import {
  botBlob,
  bypassChange,
  bypassChoice,
  BYPASS_CHIPS,
  dateText,
  MUTE_CHIPS,
  mutedLabel,
  selectedMuteChip,
  type BotListItem,
  type BypassChoice,
  type MuteChoice,
} from "../botsModel";
import type { BotBypass, BypassMode } from "../localSettings";
import type { SoundKind } from "../botSoundSettings";
import { fromText } from "../pairingModel";
import { Glyph, ICON } from "../ui/AlertFrame";
import { Blob } from "../ui/Blob";
import { Btn } from "../ui/Btn";
import { Chip } from "../ui/Chip";
import { Group } from "../ui/Group";
import { Row } from "../ui/Row";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { OnboardingFrame } from "../onboarding/parts";
import { KvRow, KvText, MAX_FONT_SCALE, NavBar } from "./PairingParts";

export interface B2BotProps {
  bot: BotListItem;
  now: number;
  /** This bot's local overrides of Do Not Disturb and silent mode. */
  bypass: BotBypass | undefined;
  onMute: (choice: MuteChoice) => void;
  /** A mode, or null for "Default". */
  onBypass: (which: "dnd" | "silent", mode: BypassMode | null) => void;
  onColour: (colour: string) => void;
  onSound: (kind: SoundKind) => void;
  /** The second tap of Remove. */
  onRemove: () => void;
  onBack: () => void;
  /** A change is in flight: Remove is still. */
  busy?: boolean;
  /** An error from the last change; null for none. */
  error?: string | null;
}

export function B2Bot({
  bot,
  now,
  bypass,
  onMute,
  onBypass,
  onColour,
  onSound,
  onRemove,
  onBack,
  busy = false,
  error = null,
}: B2BotProps) {
  const t = useTheme().tokens;
  const look = useMemo(() => botBlob(bot), [bot]);
  const muteChip = selectedMuteChip(bot.mutedUntil, now);
  const muted = mutedLabel(bot.mutedUntil, now);

  return (
    <OnboardingFrame>
      <NavBar onBack={onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Blob bot={look} size={104} />
          <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: t.ink }]}>
            {bot.name}
          </Text>
          <Text selectable style={[styles.id, { color: t.ink3 }]}>
            {bot.botId}
          </Text>
        </View>

        <Section label="Mute" />
        <View style={styles.chips}>
          {MUTE_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              label={chip.label}
              selected={chip.id === muteChip}
              onPress={() => onMute(chip.id)}
              testID={`mute-${chip.id}`}
            />
          ))}
        </View>
        <Caption testID="mute-note">
          {muted ? `${muted}. ` : ""}A muted bot makes no sound or notification and never takes over the screen. Its alerts wait under Needs you.
        </Caption>

        <Section label="Through Do Not Disturb" />
        <BypassChips
          which="dnd"
          current={bypassChoice(bypass, "dnd")}
          onChoose={(choice) => onBypass("dnd", bypassChange(choice))}
        />
        <Section label="Through silent mode" />
        <BypassChips
          which="silent"
          current={bypassChoice(bypass, "silent")}
          onChoose={(choice) => onBypass("silent", bypassChange(choice))}
        />
        <Caption>Only when {bot.name} asks. Default follows Alert sounds (urgent only).</Caption>

        <Section label="Sound" />
        <Group>
          <Row
            title="Normal alerts"
            value="Default"
            leading={<IconTile d={ICON.sound} />}
            chevron
            onPress={() => onSound("normal")}
            testID="sound-normal"
          />
          <Row
            title="Urgent alerts"
            value="Default"
            leading={<IconTile d={ICON.alarm} />}
            chevron
            onPress={() => onSound("urgent")}
            testID="sound-urgent"
          />
        </Group>
        <Caption>Opens Android's sound settings. Every bot shares them for now.</Caption>

        <Section label="Colour" />
        <View style={styles.swatches}>
          {PALETTE.map((entry) => {
            const selected = entry.name === look.colour;
            return (
              <View key={entry.name} style={styles.swatchCell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={entry.name}
                  accessibilityState={{ selected }}
                  testID={`swatch-${entry.name}`}
                  onPress={() => onColour(entry.name)}
                  style={[styles.swatchRing, { borderColor: selected ? t.ink : "transparent" }]}
                >
                  <View style={[styles.swatch, { backgroundColor: entry.base }]} />
                </Pressable>
              </View>
            );
          })}
        </View>

        <Section label="Details" />
        <View style={[styles.details, { backgroundColor: t.fill }]}>
          <KvRow label="Added from" first>
            <KvText>{fromText(bot.addedFrom)}</KvText>
          </KvRow>
          <KvRow label="Paired">
            <KvText>{dateText(bot.createdAt)}</KvText>
          </KvRow>
        </View>

        {error ? (
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: t.danger }]}>
            {error}
          </Text>
        ) : null}
        <View style={styles.remove}>
          <Btn
            label={`Remove ${bot.name}`}
            variant="danger"
            disabled={busy}
            tapTwice={{ onConfirm: onRemove, armedLabel: "Tap again to remove" }}
            testID="remove-bot"
          />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.removeNote, { color: t.ink3 }]}>
            Its key stops working and its waiting alerts are cancelled.
          </Text>
        </View>
      </ScrollView>
    </OnboardingFrame>
  );
}

function BypassChips({
  which,
  current,
  onChoose,
}: {
  which: "dnd" | "silent";
  current: BypassChoice;
  onChoose: (choice: BypassChoice) => void;
}) {
  return (
    <View style={styles.chips}>
      {BYPASS_CHIPS.map((chip) => (
        <Chip
          key={chip.id}
          label={chip.label}
          selected={chip.id === current}
          onPress={() => onChoose(chip.id)}
          testID={`${which}-${chip.id}`}
        />
      ))}
    </View>
  );
}

function Section({ label }: { label: string }) {
  const t = useTheme().tokens;
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.section, { color: t.ink3 }]}>
      {label}
    </Text>
  );
}

function Caption({ children, testID }: { children: string | string[]; testID?: string }) {
  const t = useTheme().tokens;
  return (
    <Text testID={testID} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caption, { color: t.ink3 }]}>
      {children}
    </Text>
  );
}

/** `.gi`: a 34 dp tile with the icon in it. */
function IconTile({ d }: { d: string }) {
  const t = useTheme().tokens;
  return (
    <View style={[styles.tile, { backgroundColor: t.card }]}>
      <Glyph d={d} size={18} colour={t.ink} width={2.1} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  hero: { alignItems: "center", paddingHorizontal: 28 },
  name: { fontFamily: fontFamily.black, fontSize: 28, fontWeight: "900", letterSpacing: 28 * -0.015, marginTop: 14 },
  id: { fontFamily: "monospace", fontWeight: "700", fontSize: 13.5, marginTop: 4 },
  section: {
    fontFamily: fontFamily.black,
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 12.5 * 0.08,
    textTransform: "uppercase",
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 6,
  },
  /** `.chips{gap:8px; padding:4px 16px 0}` */
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4, paddingHorizontal: 16 },
  caption: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13.5,
    lineHeight: 13.5 * 1.4,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  tile: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  /** `.swatches{gap:10px; padding:6px 22px 0}`, seven to a row. */
  swatches: { flexDirection: "row", flexWrap: "wrap", paddingTop: 6, paddingHorizontal: 17 },
  swatchCell: { width: `${100 / 7}%`, padding: 5 },
  swatchRing: { aspectRatio: 1, borderRadius: 999, borderWidth: 2, padding: 2 },
  swatch: { flex: 1, borderRadius: 999 },
  details: { marginTop: 4, marginHorizontal: 16, borderRadius: 18, overflow: "hidden" },
  error: {
    fontFamily: fontFamily.extraBold,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    paddingTop: 14,
    paddingHorizontal: 22,
  },
  /** `padding:22px 20px 0` */
  remove: { paddingTop: 22, paddingHorizontal: 20 },
  removeNote: { fontFamily: fontFamily.semiBold, fontSize: 13.5, textAlign: "center", paddingTop: 10 },
});
