/**
 * H4 Alert detail: an alert from Earlier (or a snoozed one from Needs you, when it is opened the
 * same way), with the bot, the question and message, the options with the picks marked, his reply,
 * the attachments, the timeline, and Try again for a failed delivery (J10).
 * Prototype: `SCREENS.detail` and `.tl`, `.ans`, `.quote` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` H4; `User journeys.md` J10.
 *
 * `H4DetailView` only draws: it is given the alert and callbacks, so the dev sample route can show it
 * with no backend. `H4Detail` reads `alerts.get` and `answers.retryDelivery` for the screen.
 */
import { anyApi } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  type AlertDetail,
  attachmentChips,
  alertWhen,
  deliveryError,
  optionRows,
  replyQuote,
  retryErrorMessage,
  showTryAgain,
  statusLine,
  timelineRows,
  type OptionRow,
  type TimelineRow,
} from "../detailModel";
import { readClientId } from "../clientStore";
import { OnboardingFrame } from "../onboarding/parts";
import { Glyph, ICON } from "../ui/AlertFrame";
import { Blob } from "../ui/Blob";
import { type BotTheme } from "../ui/botTheme";
import { botLook } from "../ui/botLook";
import { Btn } from "../ui/Btn";
import { Toast, useToast } from "../ui/Toast";
import { useBotTheme, useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";

const MAX_FONT_SCALE = 1.3;
const BACK = "M15 5l-7 7 7 7";

/* ------------------------------------------------------------------ the view */

export interface H4DetailViewProps {
  /** The alert; undefined while it loads, null when it is not there (the "gone" state). */
  alert: AlertDetail | null | undefined;
  /** Now, so the times follow the clock. */
  now: number;
  onBack: () => void;
  /**
   * Try again. Resolves with a message for a Toast (or null). While it runs the button shows
   * "Retrying…" and is disabled.
   */
  onRetry: () => Promise<string | null>;
}

export function H4DetailView({ alert, now, onBack, onRetry }: H4DetailViewProps) {
  const t = useTheme().tokens;
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);

  // The Android back gesture goes back to Home, as the Back control does.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const retry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const message = await onRetry();
      if (message) toast.show(message);
    } finally {
      setRetrying(false);
    }
  }, [onRetry, retrying, toast.show]);

  return (
    <OnboardingFrame>
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed ? { backgroundColor: t.fill } : null]}
        >
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path d={BACK} fill="none" stroke={t.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.navTitle, { color: t.ink }]}>
          Alert
        </Text>
      </View>

      {alert === null ? (
        <GoneState onBack={onBack} />
      ) : alert === undefined ? null : (
        <AlertBody alert={alert} now={now} retrying={retrying} onRetry={retry} />
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </OnboardingFrame>
  );
}

/** "This alert is gone": the alert is not on this phone (or was never sent to it). */
function GoneState({ onBack }: { onBack: () => void }) {
  const t = useTheme().tokens;
  return (
    <View style={styles.gone}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.goneTitle, { color: t.ink }]}>
        This alert is gone
      </Text>
      <View style={styles.goneBack}>
        <Btn label="Back" variant="line" onPress={onBack} />
      </View>
    </View>
  );
}

function AlertBody({
  alert,
  now,
  retrying,
  onRetry,
}: {
  alert: AlertDetail;
  now: number;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useTheme().tokens;
  const look = useMemo(() => botLook({ botId: alert.botId, botName: alert.botName }), [alert.botId, alert.botName]);
  const bot = useBotTheme(look);
  const options = useMemo(() => optionRows(alert), [alert]);
  const timeline = useMemo(() => timelineRows(alert, now), [alert, now]);
  const chips = useMemo(() => attachmentChips(alert), [alert]);
  const quote = replyQuote(alert);
  const error = deliveryError(alert);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <View style={styles.who}>
        <Blob bot={look} size={44} still />
        <View style={styles.whoText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.botName, { color: t.ink }]}>
            {alert.botName}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.when, { color: t.ink3 }]}>
            {alertWhen(alert, now)}
          </Text>
        </View>
      </View>

      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.question, { color: t.ink }]}>
        {alert.question}
      </Text>
      {alert.message ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.message, { color: t.ink2 }]}>
          {alert.message}
        </Text>
      ) : null}

      <Text accessibilityRole="text" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: t.ink3 }]}>
        {statusLine(alert, now)}
      </Text>

      {options.length > 0 ? (
        <View style={styles.options}>
          {options.map((option) => (
            <OptionView key={option.id} option={option} bot={bot} />
          ))}
        </View>
      ) : null}

      {quote ? (
        <View style={[styles.quote, { borderLeftColor: bot.bot, backgroundColor: t.fill }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.quoteText, { color: t.ink2 }]}>
            “{quote}”
          </Text>
        </View>
      ) : null}

      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <View
              key={chip.key}
              accessible
              accessibilityLabel={`${chip.name}, ${chip.size}`}
              style={[styles.chip, { backgroundColor: t.fill }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.chipName, { color: t.ink }]}>
                {chip.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipSize, { color: t.ink3 }]}>
                {chip.size}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.section, { color: t.ink3 }]}>
        Timeline
      </Text>
      <View style={styles.timeline}>
        {timeline.map((row) => (
          <TimelineItem key={row.key} row={row} />
        ))}
      </View>

      {showTryAgain(alert) ? (
        <View style={styles.retry}>
          <Btn label={retrying ? "Retrying…" : "Try again"} variant="line" disabled={retrying} onPress={onRetry} />
          {error ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: t.ink3 }]}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** `.ans div`: a plain row; `.ans div.pick`: the bot's tint with its edge and a check. */
function OptionView({ option, bot }: { option: OptionRow; bot: BotTheme }) {
  const t = useTheme().tokens;
  const picked = option.picked;
  const destructive = option.destructive;
  const edge = destructive ? (picked ? t.danger : t.dangeredge) : picked ? bot.bot : t.line;
  const fill = picked ? (destructive ? t.dangerbg : bot.botTint) : t.card;
  const labelColour = destructive ? t.danger : t.ink;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${option.label}${picked ? ", picked" : ""}`}
      style={[styles.option, { borderColor: edge, backgroundColor: fill }]}
    >
      <View style={styles.optionText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.optionLabel, { color: labelColour }]}>
          {option.label}
        </Text>
        {option.desc ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.optionDesc, { color: t.ink2 }]}>
            {option.desc}
          </Text>
        ) : null}
      </View>
      {picked ? <Glyph d={ICON.check} size={20} colour={destructive ? t.danger : bot.bot} width={2.8} /> : null}
    </View>
  );
}

function TimelineItem({ row }: { row: TimelineRow }) {
  const t = useTheme().tokens;
  const dot = row.tone === "ok" ? t.ok : row.tone === "bad" ? t.danger : t.ink3;
  return (
    <View accessible accessibilityLabel={`${row.text}, ${row.time}`} style={styles.tlItem}>
      <View style={[styles.tlDot, { backgroundColor: dot }]} />
      <View style={styles.tlText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tlTitle, { color: t.ink }]}>
          {row.text}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tlTime, { color: t.ink3 }]}>
          {row.time}
        </Text>
      </View>
    </View>
  );
}

/* ----------------------------------------------------------------- connected */

export interface H4DetailProps {
  questionId: string;
  onBack: () => void;
}

/** A clock that ticks every 30 s, so the times and the snooze note keep up. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** H4 for a real alert: reads `alerts.get` for this client and retries a failed delivery. */
export function H4Detail({ questionId, onBack }: H4DetailProps) {
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    readClientId()
      .then(setClientId)
      .catch(() => setClientId(null));
  }, []);
  const now = useNow();
  const alert = useQuery(anyApi.alerts.get, clientId ? { clientId, questionId } : "skip") as
    | AlertDetail
    | null
    | undefined;
  const retryDelivery = useMutation(anyApi.answers.retryDelivery);

  const onRetry = useCallback(async (): Promise<string | null> => {
    const answerId = alert?.answer?.answerId;
    if (!clientId || !answerId) return null;
    try {
      await retryDelivery({ clientId, answerId });
      return null;
    } catch (error) {
      return retryErrorMessage(error);
    }
  }, [alert, clientId, retryDelivery]);

  // Without a client id (the legacy device path) there is no alert to read.
  return <H4DetailView alert={clientId === null ? null : alert} now={now} onBack={onBack} onRetry={onRetry} />;
}

const styles = StyleSheet.create({
  nav: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 56 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  navTitle: { fontFamily: fontFamily.black, fontSize: 18, fontWeight: "900", marginLeft: 6 },
  scroll: { paddingBottom: 28 },
  who: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingTop: 6 },
  whoText: { flexShrink: 1 },
  botName: { fontFamily: fontFamily.black, fontSize: 16, fontWeight: "900" },
  when: { fontFamily: fontFamily.bold, fontSize: 13.5, fontWeight: "700", marginTop: 2 },
  question: {
    fontFamily: fontFamily.black,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 26 * -0.01,
    paddingHorizontal: 22,
    paddingTop: 18,
  },
  message: { fontFamily: fontFamily.semiBold, fontSize: 15, fontWeight: "600", paddingHorizontal: 22, paddingTop: 8 },
  status: {
    fontFamily: fontFamily.black,
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 12.5 * 0.07,
    textTransform: "uppercase",
    paddingHorizontal: 22,
    paddingTop: 18,
  },
  options: { gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  option: {
    minHeight: 56,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionText: { flex: 1 },
  optionLabel: { fontFamily: fontFamily.black, fontSize: 17, fontWeight: "900" },
  optionDesc: { fontFamily: fontFamily.semiBold, fontSize: 13.5, fontWeight: "600", marginTop: 2 },
  quote: {
    marginTop: 12,
    marginHorizontal: 22,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderLeftWidth: 3,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  quoteText: { fontFamily: fontFamily.semiBold, fontSize: 15, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 22, paddingTop: 12 },
  chip: { maxWidth: "100%", borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  chipName: { fontFamily: fontFamily.bold, fontSize: 14, fontWeight: "700" },
  chipSize: { fontFamily: fontFamily.semiBold, fontSize: 12.5, fontWeight: "600", marginTop: 1 },
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
  timeline: { paddingHorizontal: 22 },
  tlItem: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8 },
  tlDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  tlText: { flex: 1 },
  tlTitle: { fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700" },
  tlTime: { fontFamily: fontFamily.semiBold, fontSize: 13, fontWeight: "600", marginTop: 1 },
  retry: { paddingHorizontal: 20, paddingTop: 14 },
  error: { fontFamily: fontFamily.semiBold, fontSize: 13, fontWeight: "600", textAlign: "center", paddingTop: 10 },
  gone: { paddingHorizontal: 22, paddingTop: 34 },
  goneTitle: { fontFamily: fontFamily.black, fontSize: 26, fontWeight: "900", letterSpacing: 26 * -0.01 },
  goneBack: { paddingTop: 22 },
});
