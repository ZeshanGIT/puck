/**
 * S4 Alert sounds: the normal and urgent sound rows (they open Android's own channel settings,
 * where the system sound stays the default), how long an urgent alert rings, and whether bots may
 * bypass Do Not Disturb and silent mode (Off, Urgent only, All alerts). Prototype: `SCREENS.sounds`
 * and `.chips` (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` S4, Q3, Q6.
 *
 * All of it is stored on the phone (`localSettings.ts`). The next urgent alert reads these fresh
 * (`urgentDisplay.ts` loads the settings for every alert), so a change here applies to it.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import type { SoundKind } from "../botSoundSettings";
import type { BypassMode } from "../localSettings";
import { GLOBAL_BYPASS_CHIPS, RING_CHIPS, selectedRingChip } from "../settingsModel";
import { OnboardingFrame } from "../onboarding/parts";
import { Chip } from "../ui/Chip";
import { Group } from "../ui/Group";
import { NavBar } from "./PairingParts";
import { Caption, ErrorLine, Section, SettingsRow } from "./SettingsParts";

export interface S4SoundsProps {
  ringSeconds: number;
  bypassDnd: BypassMode;
  bypassSilent: BypassMode;
  onSound: (kind: SoundKind) => void;
  onRing: (seconds: number) => void;
  onBypassDnd: (mode: BypassMode) => void;
  onBypassSilent: (mode: BypassMode) => void;
  error?: string | null;
  onBack: () => void;
}

export function S4Sounds(props: S4SoundsProps) {
  const ring = selectedRingChip(props.ringSeconds);
  return (
    <OnboardingFrame>
      <NavBar title="Alert sounds" onBack={props.onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Group>
          <SettingsRow
            icon="bell"
            label="Normal alerts"
            value="System sound"
            onPress={() => props.onSound("normal")}
            testID="sounds-normal"
          />
          <SettingsRow
            icon="bell"
            label="Urgent alerts"
            value="System sound"
            onPress={() => props.onSound("urgent")}
            testID="sounds-urgent"
          />
        </Group>

        <Section label="Urgent rings for" />
        <View style={styles.chips}>
          {RING_CHIPS.map((chip) => (
            <Chip
              key={chip.seconds}
              label={chip.label}
              selected={chip.seconds === ring}
              onPress={() => props.onRing(chip.seconds)}
              testID={`ring-${chip.seconds}`}
            />
          ))}
        </View>
        <Caption>An alert can ask for longer. Alarms ring for up to 5 minutes.</Caption>

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
        <Caption>Only alerts that ask to bypass. Each bot can override this, and pick its own sound, on its own page.</Caption>
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
