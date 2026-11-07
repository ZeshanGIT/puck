/**
 * S8 Preferences: how Puck looks (System, Light or Dark, applied at once and kept across restarts)
 * and whether the compact alert card may draw over other apps. The card's permission is switched
 * on by the person in Android's "Display over other apps" page; this screen only opens that page.
 * Built from the same parts as S4 Alert sounds (`Chip`, `SettingsRow`, `NavBar`).
 *
 * `S8Preferences` only draws: it is given the values and callbacks.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import { OnboardingFrame } from "../onboarding/parts";
import { Chip } from "../ui/Chip";
import { Group } from "../ui/Group";
import { THEME_CHOICES, type ThemePreference } from "../ui/themePreference";
import { NavBar } from "./PairingParts";
import { Caption, ErrorLine, Section, SettingsRow } from "./SettingsParts";

export interface S8PreferencesProps {
  theme: ThemePreference;
  /** Whether the compact card may draw over other apps; null while it is read. */
  overlayCards: boolean | null;
  onTheme: (theme: ThemePreference) => void;
  onOverlayCards: () => void;
  error?: string | null;
  onBack: () => void;
}

export function S8Preferences(props: S8PreferencesProps) {
  const overlayValue = props.overlayCards === null ? undefined : props.overlayCards ? "On" : "Off";
  return (
    <OnboardingFrame>
      <NavBar title="Preferences" onBack={props.onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Section label="Appearance" />
        <View style={styles.chips}>
          {THEME_CHOICES.map((choice) => (
            <Chip
              key={choice.id}
              label={choice.label}
              selected={choice.id === props.theme}
              onPress={() => props.onTheme(choice.id)}
              testID={`theme-${choice.id}`}
            />
          ))}
        </View>
        <Caption>System follows your phone's dark setting. Light and Dark stay as you chose them.</Caption>

        <Section label="Alert cards" />
        <Group>
          <SettingsRow
            icon="bell"
            label="Show alert cards over apps"
            value={overlayValue}
            tone={props.overlayCards ? "ok" : "neutral"}
            onPress={props.onOverlayCards}
            testID="prefs-overlay"
          />
        </Group>
        <Caption>
          On an unlocked phone, Puck shows a small card over the app you are using. Tap it to open the alert. Android asks you to allow it on its own page. Puck cannot switch it on for you.
        </Caption>
        <ErrorLine message={props.error ?? null} />
      </ScrollView>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  /** Same chip row as S4: `.chips{gap:8px; padding:4px 16px 0}` */
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4, paddingHorizontal: 16 },
});
