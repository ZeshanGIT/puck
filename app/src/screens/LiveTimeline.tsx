/**
 * A finished live activity, opened from the Archive: the bot and the task, how it ended, and every
 * step it went through with the time it started and how long it ran, with the bot's notes (smaller,
 * under their step, each with its time). Steps it was given but never
 * reached (a failed or stopped task) are listed after. Back returns to the Archive.
 */
import { useEffect, useMemo } from "react";
import { BackHandler, ScrollView, StyleSheet, View } from "react-native";
import { liveArchiveRow, liveTimeline, stepsNotReached, type ArchivedLive } from "../liveArchive";
import { OnboardingFrame } from "../onboarding/parts";
import { Blob } from "../ui/Blob";
import { Text } from "../ui/Text";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { useBotLook } from "../ui/useBotLook";
import { Section } from "./H1Home";
import { KvRow, KvText, MAX_FONT_SCALE, NavBar } from "./PairingParts";

export function LiveTimeline({ item, onBack }: { item: ArchivedLive; onBack: () => void }) {
  const t = useTheme().tokens;
  const { botId, botName } = item;
  const bot = useBotLook({ botId, botName });
  const row = useMemo(() => liveArchiveRow(item), [item]);
  const entries = useMemo(() => liveTimeline(item), [item]);
  const missed = useMemo(() => stepsNotReached(item), [item]);
  const toneColour = row.tone === "ok" ? t.ok : row.tone === "bad" ? t.danger : t.ink2;

  // Back closes this first; it is registered after the Archive's handler, so it runs first.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  return (
    <OnboardingFrame>
      <NavBar title="Task" onBack={onBack} backTestID="live-timeline-back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Blob bot={bot} size={72} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bot, { color: t.ink2 }]}>
            {botName}
          </Text>
          <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: t.ink }]}>
            {item.title}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: toneColour }]}>
            {row.detail}
          </Text>
        </View>

        <Section label="Steps" />
        <View style={[styles.box, { backgroundColor: t.fill }]} testID="live-timeline-steps">
          {entries.map((entry, index) =>
            entry.kind === "note" ? (
              <View key={`note-${index}`} style={styles.note}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: t.ink2 }]}>
                  {entry.label}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteTime, { color: t.ink3 }]}>
                  {entry.time}
                </Text>
              </View>
            ) : (
              <KvRow key={`${entry.kind}-${index}`} label={entry.label} first={index === 0}>
                <KvText>{entry.took === null ? entry.time : `${entry.time} · ${entry.took}`}</KvText>
              </KvRow>
            ),
          )}
        </View>

        {missed.length > 0 ? (
          <>
            <Section label="Not reached" />
            <View style={[styles.box, { backgroundColor: t.fill }]}>
              {missed.map((step, index) => (
                <KvRow key={step} label={step} first={index === 0}>
                  <KvText>—</KvText>
                </KvRow>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  hero: { alignItems: "center", paddingHorizontal: 28, paddingTop: 4 },
  bot: { fontFamily: fontFamily.extraBold, fontSize: 14, fontWeight: "800", marginTop: 10 },
  title: { fontFamily: fontFamily.black, fontSize: 24, fontWeight: "900", textAlign: "center", marginTop: 4 },
  summary: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800", marginTop: 6 },
  box: { marginTop: 4, marginHorizontal: 16, borderRadius: 18, overflow: "hidden" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingLeft: 30, paddingRight: 16, paddingBottom: 10, marginTop: -4 },
  noteText: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: 14, fontWeight: "600" },
  noteTime: { fontFamily: fontFamily.semiBold, fontSize: 12.5, fontWeight: "600", marginTop: 1 },
});
