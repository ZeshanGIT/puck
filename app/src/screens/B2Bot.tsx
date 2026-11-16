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
import { SHAPES, type ShapeName } from "../ui/blobShapes";
import {
  botBlob,
  dateText,
  MUTE_CHIPS,
  mutedLabel,
  selectedMuteChip,
  type BotListItem,
  type MuteChoice,
} from "../botsModel";
import { modeAllows, withModeFor, type BotBypass, type BypassMode } from "../localSettings";
import type { SoundKind } from "../botSoundSettings";
import { REMINDER_CHIPS } from "../reminderChoices";
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

const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

export interface B2BotProps {
  bot: BotListItem;
  now: number;
  /** This bot's local overrides of Do Not Disturb and silent mode. */
  bypass: BotBypass | undefined;
  onMute: (choice: MuteChoice) => void;
  /** A mode, or null to follow app settings. */
  onBypass: (which: "dnd" | "silent", mode: BypassMode | null) => void;
  onColour: (colour: string) => void;
  onShape: (shape: ShapeName) => void;
  /** Minutes between reminders for this kind of alert, or null to follow app settings. */
  onReminder: (kind: SoundKind, minutes: number | null) => void;
  /** What Alerts in Settings says about Do Not Disturb and silent mode, which this bot follows unless it has its own. */
  appBypass: { dnd: BypassMode; silent: BypassMode };
  /** What Alerts in Settings says about reminders, per kind. */
  appReminder: { normal: number; urgent: number };
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
  /** The floating card for this bot's live tasks, on or off. */
  onLiveFloat?: (on: boolean) => void;
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
  onShape,
  onReminder,
  normalRingtone,
  urgentRingtone,
  onRingtone,
  appLoop,
  onLoop,
  appFullScreen,
  onFullScreen,
  onLiveFloat,
  appBypass,
  appReminder,
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

        {(["normal", "urgent"] as const).map((kind) => {
          const urgent = kind === "urgent";
          const dnd = bypass?.dnd ?? appBypass.dnd;
          const silent = bypass?.silent ?? appBypass.silent;
          const ownReminder = urgent ? bypass?.reminderMinutes : bypass?.reminderMinutesNormal;
          const appReminderFor = urgent ? appReminder.urgent : appReminder.normal;
          const ringtone = urgent ? urgentRingtone : normalRingtone;
          const following =
            ringtone === null &&
            (urgent ? bypass?.loopUrgent : bypass?.loopNormal) === undefined &&
            (urgent ? bypass?.fullScreenUrgent : bypass?.fullScreenNormal) === undefined &&
            ownReminder === undefined &&
            modeAllows(dnd, kind) === modeAllows(appBypass.dnd, kind) &&
            modeAllows(silent, kind) === modeAllows(appBypass.silent, kind);
          const setBypass = (which: "dnd" | "silent", on: boolean) => {
            const app = which === "dnd" ? appBypass.dnd : appBypass.silent;
            const next = withModeFor(which === "dnd" ? dnd : silent, kind, on);
            onBypass(which, next === app ? null : next);
          };
          return (
            <KindSection
              key={kind}
              kind={kind}
              ringtone={ringtone}
              loop={(urgent ? bypass?.loopUrgent : bypass?.loopNormal) ?? (urgent ? appLoop.urgent : appLoop.normal)}
              fullScreen={
                (urgent ? bypass?.fullScreenUrgent : bypass?.fullScreenNormal) ??
                (urgent ? appFullScreen.urgent : appFullScreen.normal)
              }
              dnd={modeAllows(dnd, kind)}
              silent={modeAllows(silent, kind)}
              reminder={ownReminder ?? appReminderFor}
              following={following}
              onRingtone={onRingtone}
              onLoop={onLoop}
              onFullScreen={onFullScreen}
              onBypass={setBypass}
              onReminder={(minutes) => onReminder(kind, minutes === appReminderFor ? null : minutes)}
              onReset={onResetSound}
            />
          );
        })}
        <Caption>
          These apply to {bot.name} only. Until you change one, it follows Alerts in Settings. Do Not Disturb and silent mode are bypassed only when {bot.name} asks.
        </Caption>

        <Section label="Live tasks" />
        <Group>
          <SettingsToggleRow
            icon="phone"
            label="Float over other apps"
            value={bypass?.liveFloat === true}
            onChange={(next) => onLiveFloat?.(next)}
            testID="live-float"
          />
        </Group>
        <Caption testID="live-float-caption">
          {`While ${bot.name} works on something, a small bubble with its progress floats at the edge of the screen. Tap it to see the step and note; drag it to the × to hide it until the next step. It still shows in the notification shade.`}
        </Caption>

        <Section label="Shape" />
        <View style={styles.shapes}>
          {SHAPE_NAMES.map((shape) => {
            const selected = shape === look.shape;
            return (
              <Pressable
                key={shape}
                accessibilityRole="button"
                accessibilityLabel={shape}
                accessibilityState={{ selected }}
                testID={`shape-${shape}`}
                onPress={() => onShape(shape)}
                style={[styles.shapeRing, { borderColor: selected ? t.ink : "transparent" }]}
              >
                <Blob bot={{ ...look, shape, tilt: 0 }} size={44} still />
              </Pressable>
            );
          })}
        </View>

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
          {bot.hasWebhook === undefined ? null : (
            <KvRow label="Answers">
              <KvText>{bot.hasWebhook ? "Sent to its webhook" : "It asks for them (no webhook)"}</KvText>
            </KvRow>
          )}
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
 * One kind of alert for this bot: card or full screen, ringtone, Repeat, Do Not Disturb, silent
 * mode and reminders, each showing the bot's own value or the app's, and, once anything is the
 * bot's own, a row that puts this kind back on the app's settings.
 */
function KindSection({
  kind,
  ringtone,
  loop,
  fullScreen,
  dnd,
  silent,
  reminder,
  following,
  onRingtone,
  onLoop,
  onFullScreen,
  onBypass,
  onReminder,
  onReset,
}: {
  kind: SoundKind;
  /** The bot's own ringtone by name; null when it follows app settings. */
  ringtone: string | null;
  loop: boolean;
  fullScreen: boolean;
  dnd: boolean;
  silent: boolean;
  /** Minutes between reminders; 0 is off. */
  reminder: number;
  /** Nothing here is the bot's own: it follows app settings entirely. */
  following: boolean;
  onRingtone: (kind: SoundKind) => void;
  onLoop: (kind: SoundKind, loop: boolean) => void;
  onFullScreen: (kind: SoundKind, fullScreen: boolean) => void;
  onBypass: (which: "dnd" | "silent", on: boolean) => void;
  onReminder: (minutes: number) => void;
  onReset: (kind: SoundKind) => void;
}) {
  const t = useTheme().tokens;
  return (
    <>
      <Section label={kind === "urgent" ? "Urgent alerts" : "Normal alerts"} />
      <Group>
        <SettingsToggleRow
          icon="phone"
          label="Full screen while I use my phone"
          value={fullScreen}
          onChange={(next) => onFullScreen(kind, next)}
          testID={`sound-${kind}-fullscreen`}
        />
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
          icon="moon"
          label="Ring through Do Not Disturb"
          value={dnd}
          onChange={(next) => onBypass("dnd", next)}
          testID={`${kind}-dnd`}
        />
        <SettingsToggleRow
          icon="mute"
          label="Ring in silent mode"
          value={silent}
          onChange={(next) => onBypass("silent", next)}
          testID={`${kind}-silent`}
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
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: t.ink3 }]}>
        Remind me
      </Text>
      <View style={styles.chips}>
        {REMINDER_CHIPS.map((chip) => (
          <Chip
            key={chip.minutes}
            label={chip.label}
            selected={chip.minutes === reminder}
            onPress={() => onReminder(chip.minutes)}
            testID={`reminder-${kind}-${chip.minutes}`}
          />
        ))}
      </View>
    </>
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
  sub: { fontFamily: fontFamily.extraBold, fontSize: 13, paddingTop: 14, paddingHorizontal: 18 },
  caption: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13.5,
    lineHeight: 13.5 * 1.4,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  tile: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  /** `.swatches{gap:10px; padding:6px 22px 0}`, seven to a row. */
  shapes: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, paddingHorizontal: 20 },
  shapeRing: { borderRadius: 18, borderWidth: 2, padding: 6 },
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
