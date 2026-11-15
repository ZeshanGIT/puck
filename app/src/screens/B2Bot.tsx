/**
 * B2 Bot detail: one bot's settings. Mute (stored on the backend as `mutedUntil`), whether it may
 * come through Do Not Disturb and silent mode (stored on the phone, Protocol changes section 6),
 * its own ringtones, how often it reminds about an unanswered urgent alert, its colour, the details, and Remove with
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
import { BOT_REMINDER_CHIPS, reminderChange, reminderChoice, type ReminderChoice } from "../reminderChoices";
import { fromText } from "../pairingModel";
import { Blob } from "../ui/Blob";
import { Btn } from "../ui/Btn";
import { Chip } from "../ui/Chip";
import { Group } from "../ui/Group";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { OnboardingFrame } from "../onboarding/parts";
import { KvRow, KvText, MAX_FONT_SCALE, NavBar } from "./PairingParts";
import { SettingsRow, SettingsToggleRow } from "./SettingsParts";

export interface B2BotProps {
  bot: BotListItem;
  now: number;
  /** This bot's local overrides of Do Not Disturb and silent mode. */
  bypass: BotBypass | undefined;
  onMute: (choice: MuteChoice) => void;
  /** A mode, or null to follow app settings. */
  onBypass: (which: "dnd" | "silent", mode: BypassMode | null) => void;
  onColour: (colour: string) => void;
  /** Minutes between reminders, or null to follow app settings. */
  onReminder: (minutes: number | null) => void;
  /** This bot's own ringtone for each kind of alert, by name; null when it follows the default. */
  normalRingtone: string | null;
  urgentRingtone: string | null;
  /** Opens the ringtone picker for this bot. */
  onRingtone: (kind: SoundKind) => void;
  /** What Alert sounds says about repeating, which this bot follows unless it has its own. */
  appLoop: { normal: boolean; urgent: boolean };
  /** Turns repeating on or off for this bot. */
  onLoop: (kind: SoundKind, loop: boolean) => void;
  /** What Alert sounds says about full screen while the phone is in use, which this bot follows unless it has its own. */
  appFullScreen: { normal: boolean; urgent: boolean };
  /** Full screen (true) or the card (false) for this bot's alerts while the phone is in use. */
  onFullScreen: (kind: SoundKind, fullScreen: boolean) => void;
  /** Follows Alert sounds again for this kind of alert: the ringtone, repeating, and full screen. */
  onResetSound: (kind: SoundKind) => void;
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
  onReminder,
  normalRingtone,
  urgentRingtone,
  onRingtone,
  appLoop,
  onLoop,
  appFullScreen,
  onFullScreen,
  onResetSound,
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
        <Caption>Only when {bot.name} asks. Follow app settings uses Alert sounds in Settings (urgent only).</Caption>

        <SoundSection
          title="Normal alerts"
          kind="normal"
          ringtone={normalRingtone}
          loop={bypass?.loopNormal ?? appLoop.normal}
          fullScreen={bypass?.fullScreenNormal ?? appFullScreen.normal}
          following={normalRingtone === null && bypass?.loopNormal === undefined && bypass?.fullScreenNormal === undefined}
          onRingtone={onRingtone}
          onLoop={onLoop}
          onFullScreen={onFullScreen}
          onReset={onResetSound}
        />
        <SoundSection
          title="Urgent alerts"
          kind="urgent"
          ringtone={urgentRingtone}
          loop={bypass?.loopUrgent ?? appLoop.urgent}
          fullScreen={bypass?.fullScreenUrgent ?? appFullScreen.urgent}
          following={urgentRingtone === null && bypass?.loopUrgent === undefined && bypass?.fullScreenUrgent === undefined}
          onRingtone={onRingtone}
          onLoop={onLoop}
          onFullScreen={onFullScreen}
          onReset={onResetSound}
        />
        <Caption>
          These apply to {bot.name} only. Until you change one, it follows app settings.
        </Caption>

        <Section label="Remind me" />
        <View style={styles.chips}>
          {BOT_REMINDER_CHIPS.map((chip) => (
            <Chip
              key={String(chip.id)}
              label={chip.label}
              selected={chip.id === reminderChoice(bypass)}
              onPress={() => onReminder(reminderChange(chip.id as ReminderChoice))}
              testID={`reminder-${chip.id}`}
            />
          ))}
        </View>
        <Caption>
          How often an urgent alert from {bot.name} rings again while nobody has answered it. Follow app settings uses Alert sounds in Settings.
        </Caption>

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

/**
 * One kind of alert's sound on a bot's page: its ringtone, whether it repeats, and, once either is
 * the bot's own, a row that puts the bot back on Alert sounds. Built from the same rows as the Alert
 * sounds screen, so the two read alike.
 */
function SoundSection({
  title,
  kind,
  ringtone,
  loop,
  fullScreen,
  following,
  onRingtone,
  onLoop,
  onFullScreen,
  onReset,
}: {
  title: string;
  kind: SoundKind;
  /** The bot's own ringtone by name; null when it follows app settings. */
  ringtone: string | null;
  loop: boolean;
  fullScreen: boolean;
  /** Nothing here is the bot's own: it follows app settings entirely. */
  following: boolean;
  onRingtone: (kind: SoundKind) => void;
  onLoop: (kind: SoundKind, loop: boolean) => void;
  onFullScreen: (kind: SoundKind, fullScreen: boolean) => void;
  onReset: (kind: SoundKind) => void;
}) {
  return (
    <>
      <Section label={title} />
      <Group>
        <SettingsRow
          icon="bell"
          label="Ringtone"
          value={ringtone ?? "Follows app settings"}
          onPress={() => onRingtone(kind)}
          testID={`sound-${kind}`}
        />
        <SettingsToggleRow
          icon="sound"
          label="Repeat the ringtone"
          value={loop}
          onChange={(next) => onLoop(kind, next)}
          testID={`sound-${kind}-loop`}
        />
        <SettingsToggleRow
          icon="phone"
          label="Full screen while I use my phone"
          value={fullScreen}
          onChange={(next) => onFullScreen(kind, next)}
          testID={`sound-${kind}-fullscreen`}
        />
        {following ? null : (
          <SettingsRow
            icon="undo"
            label="Follow app settings"
            chevron={false}
            onPress={() => onReset(kind)}
            testID={`sound-${kind}-reset`}
          />
        )}
      </Group>
    </>
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
