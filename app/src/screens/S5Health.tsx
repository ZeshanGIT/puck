/**
 * S5 Alert health: one place that answers "will Puck reach me?" (journey J12). Each requirement
 * has a clear yes or no and, when it is no, the fix: Turn on or Allow open the right system
 * screen. Below: Send a test page (the same page as O3) and what became of it, and a hint about
 * battery use (Android cannot be asked, so it is a hint only). Prototype: `SCREENS.health`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` S5.
 *
 * `S5Health` only draws: `snapshot` is undefined until the phone's states have been read, and the
 * rows come from `healthChecks` (`settingsModel.ts`).
 */
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import {
  healthChecks,
  healthTitle,
  testPageLine,
  type HealthCheck,
  type HealthFixId,
  type HealthSnapshot,
  type TestPageStatus,
} from "../settingsModel";
import { OnboardingFrame } from "../onboarding/parts";
import { Blob } from "../ui/Blob";
import { SAMPLE_BOTS } from "../ui/blobShapes";
import { Btn } from "../ui/Btn";
import { Group } from "../ui/Group";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { Glyph } from "../ui/AlertFrame";
import { MAX_FONT_SCALE, NavBar } from "./PairingParts";
import { Caption, SETTINGS_ICON } from "./SettingsParts";

export interface S5HealthProps {
  snapshot: HealthSnapshot | undefined;
  test: TestPageStatus;
  /** Turn on or Allow: opens the system screen for this check. */
  onFix: (id: HealthFixId) => void;
  /** Sends the test page now (0) or after a delay, so the phone can be locked first. */
  onSendTest: (delaySeconds: number) => void;
  /** Opens the app's settings, where Android's battery usage lives. */
  onBattery: () => void;
  /** Local time text for the test result ("14:02"). */
  timeText: (at: number) => string;
  onBack: () => void;
}

/** Seconds between tapping the delayed button and the page, so the phone can be locked first. */
export const TEST_DELAY_SECONDS = 10;

export function S5Health({ snapshot, test, onFix, onSendTest, onBattery, timeText, onBack }: S5HealthProps) {
  const t = useTheme().tokens;
  const checks = useMemo(() => (snapshot ? healthChecks(snapshot) : []), [snapshot]);
  const title = snapshot ? healthTitle(checks) : "Checking…";
  const sending = test.kind === "sending";
  const line = testPageLine(test, timeText);

  return (
    <OnboardingFrame>
      <NavBar title="Alert health" onBack={onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Blob bot={SAMPLE_BOTS.puck} size={72} live />
          <Text
            accessibilityRole="header"
            testID="health-title"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.title, { color: t.ink }]}
          >
            {title}
          </Text>
        </View>

        <View style={styles.checks}>
          <Group>
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} onFix={onFix} />
            ))}
          </Group>
        </View>

        <View style={styles.buttons}>
          <Btn
            label={sending ? "Sending…" : "Send a test page"}
            variant="line"
            disabled={sending}
            onPress={() => onSendTest(0)}
            testID="health-test-page"
          />
          <Btn
            label="Send in 10 s, so I can lock the phone"
            variant="ghost"
            disabled={sending}
            onPress={() => onSendTest(TEST_DELAY_SECONDS)}
            testID="health-test-page-delayed"
          />
          {line ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="health-test-result"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.result, { color: test.kind === "error" ? t.danger : t.ink2 }]}
            >
              {line}
            </Text>
          ) : null}
        </View>

        <Caption>
          Alerts arriving late? Set Puck's battery use to Unrestricted in Android's app settings. Puck can't read that setting, so
          it isn't checked above.
        </Caption>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Puck's app settings"
          onPress={onBattery}
          testID="health-battery"
          hitSlop={8}
          style={styles.battery}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.batteryText, { color: t.ink }]}>
            Open app settings
          </Text>
        </Pressable>
      </ScrollView>
    </OnboardingFrame>
  );
}

function CheckRow({ check, onFix }: { check: HealthCheck; onFix: (id: HealthFixId) => void }) {
  const t = useTheme().tokens;
  const { state } = check;
  const bg = state === "ok" ? t.okbg : state === "bad" ? t.warnbg : t.fill2;
  const colour = state === "ok" ? t.ok : state === "bad" ? t.warn : t.ink3;
  const icon = state === "ok" ? SETTINGS_ICON.check : state === "bad" ? SETTINGS_ICON.warn : SETTINGS_ICON.dash;
  const stateWord = state === "ok" ? "OK" : state === "bad" ? "Needs attention" : "Unknown";
  return (
    <View
      style={styles.row}
      testID={`health-row-${check.id}`}
      accessible
      accessibilityLabel={`${check.label}, ${stateWord}${state === "ok" ? "" : `. ${check.detail}`}`}
    >
      <View style={[styles.badge, { backgroundColor: bg }]}>
        <Glyph d={icon} size={13} colour={colour} width={state === "ok" ? 3.4 : 2.6} />
      </View>
      <View style={styles.main}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: t.ink }]}>
          {check.label}
        </Text>
        {state === "ok" ? null : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: state === "bad" ? t.warn : t.ink3 }]}>
            {check.detail}
          </Text>
        )}
      </View>
      {check.fix ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${check.fix.label}: ${check.label}`}
          onPress={() => onFix(check.fix!.id)}
          hitSlop={8}
          testID={`health-fix-${check.id}`}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.fix, { color: t.warn }]}>
            {check.fix.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  hero: { alignItems: "center", paddingHorizontal: 28 },
  title: { fontFamily: fontFamily.black, fontSize: 24, fontWeight: "900", letterSpacing: 24 * -0.015, marginTop: 14, textAlign: "center" },
  checks: { marginTop: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 16 },
  badge: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  main: { flex: 1, minWidth: 0 },
  label: { fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700" },
  detail: { fontFamily: fontFamily.bold, fontSize: 13, fontWeight: "700", marginTop: 2 },
  fix: { fontFamily: fontFamily.black, fontSize: 15, fontWeight: "900" },
  /** `padding:20px 20px 0` */
  buttons: { paddingTop: 20, paddingHorizontal: 20, gap: 4 },
  result: { fontFamily: fontFamily.extraBold, fontSize: 14.5, fontWeight: "800", textAlign: "center", paddingTop: 10 },
  battery: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 4, alignSelf: "flex-start" },
  batteryText: { fontFamily: fontFamily.black, fontSize: 14.5, fontWeight: "900", textDecorationLine: "underline" },
});
