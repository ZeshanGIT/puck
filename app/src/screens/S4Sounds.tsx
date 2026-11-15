/**
 * S4 Alerts (once "Alert sounds"): per kind of alert, card or full screen while the phone is in use, and the ringtone for normal alerts and for urgent alerts (each opens the phone's
 * ringtone picker; a ringtone plays once), how often an unanswered urgent alert reminds, and
 * whether bots may bypass Do Not Disturb and silent mode (Off, Urgent only, All alerts). Prototype:
 * `SCREENS.sounds` and `.chips` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` S4, Q6.
 *
 * All of it is stored on the phone (`localSettings.ts`). The next alert reads these fresh
 * (`urgentDisplay.ts` loads the settings for every alert), so a change here applies to it.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import type { SoundKind } from "../botSoundSettings";
import type { BypassMode } from "../localSettings";
import { REMINDER_CHIPS } from "../reminderChoices";
import { GLOBAL_BYPASS_CHIPS } from "../settingsModel";
import { OnboardingFrame } from "../onboarding/parts";
import { Chip } from "../ui/Chip";
import { Group } from "../ui/Group";
import { NavBar } from "./PairingParts";
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
  /** Minutes between reminders; 0 is off. */
  reminderMinutes: number;
  bypassDnd: BypassMode;
  bypassSilent: BypassMode;
  onSound: (kind: SoundKind) => void;
  onLoopNormal: (loop: boolean) => void;
  onLoopUrgent: (loop: boolean) => void;
  onFullScreenNormal: (fullScreen: boolean) => void;
  onFullScreenUrgent: (fullScreen: boolean) => void;
  onReminder: (minutes: number) => void;
  onBypassDnd: (mode: BypassMode) => void;
  onBypassSilent: (mode: BypassMode) => void;
  error?: string | null;
  onBack: () => void;
}

export function S4Sounds(props: S4SoundsProps) {
  return (
    <OnboardingFrame>
      <NavBar title="Alerts" onBack={props.onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Section label="Normal alerts" />
        <Group>
          <SettingsRow
            icon="bell"
            label="Ringtone"
            value={props.normalRingtone}
            onPress={() => props.onSound("normal")}
            testID="sounds-normal"
          />
          <SettingsToggleRow
            icon="sound"
            label="Repeat the ringtone"
            value={props.loopNormal}
            onChange={props.onLoopNormal}
            testID="sounds-loop-normal"
          />
          <SettingsToggleRow
            icon="phone"
            label="Full screen while I use my phone"
            value={props.fullScreenNormal}
            onChange={props.onFullScreenNormal}
            testID="sounds-fullscreen-normal"
          />
        </Group>

        <Section label="Urgent alerts" />
        <Group>
          <SettingsRow
            icon="bell"
            label="Ringtone"
            value={props.urgentRingtone}
            onPress={() => props.onSound("urgent")}
            testID="sounds-urgent"
          />
          <SettingsToggleRow
            icon="sound"
            label="Repeat the ringtone"
            value={props.loopUrgent}
            onChange={props.onLoopUrgent}
            testID="sounds-loop-urgent"
          />
          <SettingsToggleRow
            icon="phone"
            label="Full screen while I use my phone"
            value={props.fullScreenUrgent}
            onChange={props.onFullScreenUrgent}
            testID="sounds-fullscreen-urgent"
          />
        </Group>
        <Caption>
          Pick from your phone's ringtones. A ringtone plays once, through to the end. With Repeat on it repeats until you answer or the alert's ring time is up. While you use your phone an alert shows as a small card over the app you are in; with Full screen on it takes the whole screen instead, as it does on a locked phone. Both need "Show over other apps" in Alert health. Each bot can have its own.
        </Caption>

        <Section label="Remind me about an urgent alert" />
        <View style={styles.chips}>
          {REMINDER_CHIPS.map((chip) => (
            <Chip
              key={chip.minutes}
              label={chip.label}
              selected={chip.minutes === props.reminderMinutes}
              onPress={() => props.onReminder(chip.minutes)}
              testID={`reminder-${chip.minutes}`}
            />
          ))}
        </View>
        <Caption>An urgent alert nobody has answered rings again this often, for up to an hour. Each bot can set its own.</Caption>

        <Section label="Bots may bypass Do Not Disturb" />
        <View style={styles.chips}>
          {GLOBAL_BYPASS_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              label={chip.label}
              selected={chip.id === props.bypassDnd}
              onPress={() => props.onBypassDnd(chip.id)}
              testID={`global-dnd-${chip.id}`}
            />
          ))}
        </View>

        <Section label="Bots may bypass silent mode" />
        <View style={styles.chips}>
          {GLOBAL_BYPASS_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              label={chip.label}
              selected={chip.id === props.bypassSilent}
              onPress={() => props.onBypassSilent(chip.id)}
              testID={`global-silent-${chip.id}`}
            />
          ))}
        </View>
        <Caption>Only alerts that ask to bypass. Each bot can override this on its own page.</Caption>
        <ErrorLine message={props.error ?? null} />
      </ScrollView>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  /** `.chips{gap:8px; padding:4px 16px 0}` */
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4, paddingHorizontal: 16 },
});
