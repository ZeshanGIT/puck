/**
 * S4 Alerts (once "Alert sounds"): one section per kind of alert (normal, urgent), each with card or
 * full screen while the phone is in use, the ringtone (opens the phone's picker; it plays once),
 * Repeat, whether it may ring through Do Not Disturb and in silent mode (when the alert asks), and
 * how often it reminds while unanswered (urgent every 5 minutes, normal off, by default). Prototype:
 * `SCREENS.sounds` and `.chips` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` S4, Q6.
 *
 * All of it is stored on the phone (`localSettings.ts`). The next alert reads these fresh
 * (`urgentDisplay.ts` loads the settings for every alert), so a change here applies to it.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import type { SoundKind } from "../botSoundSettings";
import { modeAllows, type BypassMode } from "../localSettings";
import { REMINDER_CHIPS } from "../reminderChoices";
import { Text } from "../ui/Text";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { OnboardingFrame } from "../onboarding/parts";
import { Chip } from "../ui/Chip";
import { Group } from "../ui/Group";
import { MAX_FONT_SCALE, NavBar } from "./PairingParts";
import { Caption, ErrorLine, Section, SettingsRow, SettingsToggleRow } from "./SettingsParts";

export interface S4SoundsProps {
  /** The ringtone's name for each kind of alert, as the phone shows it. */
  normalRingtone: string;
  urgentRingtone: string;
  /** The ringtone repeats until the alert is answered or its ring time is up, per kind of alert. */
  loopNormal: boolean;
  loopUrgent: boolean;
  /** While the phone is in use, the alert takes the whole screen instead of the card, per kind of alert. */
  fullScreenNormal: boolean;
  fullScreenUrgent: boolean;
  /** Minutes between reminders per kind of alert; 0 is off. */
  reminderNormal: number;
  reminderUrgent: number;
  /** Which kinds may ring through Do Not Disturb and silent mode (when the alert asks). */
  bypassDnd: BypassMode;
  bypassSilent: BypassMode;
  onSound: (kind: SoundKind) => void;
  onLoop: (kind: SoundKind, loop: boolean) => void;
  onFullScreen: (kind: SoundKind, fullScreen: boolean) => void;
  onReminder: (kind: SoundKind, minutes: number) => void;
  onBypass: (which: "dnd" | "silent", kind: SoundKind, on: boolean) => void;
  error?: string | null;
  onBack: () => void;
}

export function S4Sounds(props: S4SoundsProps) {
  return (
    <OnboardingFrame>
      <NavBar title="Alerts" onBack={props.onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {(["normal", "urgent"] as const).map((kind) => (
          <KindSection key={kind} kind={kind} {...props} />
        ))}
        <Caption>
          While you use your phone an alert shows as a small card over the app you are in; with Full screen on it takes the whole screen instead, as on a locked phone. Both need "Show over other apps" in Alert health. A ringtone plays once, through to the end, unless Repeat is on. Do Not Disturb and silent mode are bypassed only for alerts that ask. An unanswered alert rings again this often, for up to an hour. Each bot can have its own.
        </Caption>
        <ErrorLine message={props.error ?? null} />
      </ScrollView>
    </OnboardingFrame>
  );
}

/** One kind of alert: how it shows, how it sounds, what it may ring through, and its reminders. */
function KindSection({ kind, ...props }: S4SoundsProps & { kind: SoundKind }) {
  const t = useTheme().tokens;
  const urgent = kind === "urgent";
  return (
    <>
      <Section label={urgent ? "Urgent alerts" : "Normal alerts"} />
      <Group>
        <SettingsToggleRow
          icon="phone"
          label="Full screen while I use my phone"
          value={urgent ? props.fullScreenUrgent : props.fullScreenNormal}
          onChange={(next) => props.onFullScreen(kind, next)}
          testID={`sounds-fullscreen-${kind}`}
        />
        <SettingsRow
          icon="bell"
          label="Ringtone"
          value={urgent ? props.urgentRingtone : props.normalRingtone}
          onPress={() => props.onSound(kind)}
          testID={`sounds-${kind}`}
        />
        <SettingsToggleRow
          icon="sound"
          label="Repeat the ringtone"
          value={urgent ? props.loopUrgent : props.loopNormal}
          onChange={(next) => props.onLoop(kind, next)}
          testID={`sounds-loop-${kind}`}
        />
        <SettingsToggleRow
          icon="moon"
          label="Ring through Do Not Disturb"
          value={modeAllows(props.bypassDnd, kind)}
          onChange={(next) => props.onBypass("dnd", kind, next)}
          testID={`sounds-dnd-${kind}`}
        />
        <SettingsToggleRow
          icon="mute"
          label="Ring in silent mode"
          value={modeAllows(props.bypassSilent, kind)}
          onChange={(next) => props.onBypass("silent", kind, next)}
          testID={`sounds-silent-${kind}`}
        />
      </Group>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: t.ink3 }]}>
        Remind me
      </Text>
      <View style={styles.chips}>
        {REMINDER_CHIPS.map((chip) => (
          <Chip
            key={chip.minutes}
            label={chip.label}
            selected={chip.minutes === (urgent ? props.reminderUrgent : props.reminderNormal)}
            onPress={() => props.onReminder(kind, chip.minutes)}
            testID={`reminder-${kind}-${chip.minutes}`}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  /** `.chips{gap:8px; padding:4px 16px 0}` */
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4, paddingHorizontal: 16 },
  sub: { fontFamily: fontFamily.extraBold, fontSize: 13, paddingTop: 14, paddingHorizontal: 18 },
});
