/**
 * S1 Settings: the way into the other settings screens. Account (the signed-in email, This phone,
 * Other clients), Alerts (Alert sounds, Alert health with its state) and Puck (About, Sign out).
 * Prototype: `SCREENS.settings` and `srow` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` S1.
 *
 * `S1Settings` only draws: it is given the values and callbacks. The sign-out sheet is S6.
 */
import { ScrollView, StyleSheet } from "react-native";
import { Group } from "../ui/Group";
import { OnboardingFrame } from "../onboarding/parts";
import { NavBar } from "./PairingParts";
import { Section, SettingsRow, type ValueTone } from "./SettingsParts";

export interface S1SettingsProps {
  email: string | null;
  /** This phone's name; undefined while it loads. */
  phoneName: string | undefined;
  /** How many clients besides this phone; null while the list loads. */
  otherClients: number | null;
  /** Alert health's state: "All good" or "Needs you"; null before it is read. */
  health: { text: string; tone: Exclude<ValueTone, "neutral"> } | null;
  /** "1.0.0" */
  version: string;
  onThisPhone: () => void;
  onClients: () => void;
  onSounds: () => void;
  onHealth: () => void;
  onAbout: () => void;
  /** Opens the sign-out sheet (S6). */
  onSignOut: () => void;
  onBack: () => void;
}

export function S1Settings(props: S1SettingsProps) {
  return (
    <OnboardingFrame>
      <NavBar title="Settings" onBack={props.onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Section label="Account" />
        <Group>
          <SettingsRow icon="user" label={props.email ?? "Signed in"} testID="settings-account" />
          <SettingsRow
            icon="phone"
            label="This phone"
            value={props.phoneName}
            onPress={props.onThisPhone}
            testID="settings-row-this-phone"
          />
          <SettingsRow
            icon="laptop"
            label="Other clients"
            value={props.otherClients === null ? undefined : String(props.otherClients)}
            onPress={props.onClients}
            testID="settings-row-clients"
          />
        </Group>

        <Section label="Alerts" />
        <Group>
          <SettingsRow icon="sound" label="Alert sounds" onPress={props.onSounds} testID="settings-row-sounds" />
          <SettingsRow
            icon="heart"
            label="Alert health"
            value={props.health?.text}
            tone={props.health?.tone}
            onPress={props.onHealth}
            testID="settings-row-health"
          />
        </Group>

        <Section label="Puck" />
        <Group>
          <SettingsRow icon="info" label="About" value={props.version} onPress={props.onAbout} testID="settings-row-about" />
          <SettingsRow icon="logout" label="Sign out" onPress={props.onSignOut} chevron={false} testID="settings-row-signout" />
        </Group>
      </ScrollView>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
});
