/**
 * The "Working now" card (H5 on Home, the same content as the N8 notification): a bot's running task.
 * From the prototype's `liveCard` and `.livecard`, `.ltrack`, `.lrail`, `.lfill`, `.tdot`, `.lrider`,
 * `.llog` (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` N8 and H5.
 *
 * - With steps: a track with a stop for each step, filled in the bot's colour up to the current one,
 *   and the bot's blob riding it. When a step finishes the blob and the fill slide to the next stop
 *   (one 1 s slide; with reduced motion they jump). Under it, the current step and "3 to go".
 * - Without steps: the last two finished steps in grey with ticks, and the current one in bold.
 *
 * Nothing pulses: the only motion is that single slide, and the blob's own eyes (its "working" sign).
 * The numbers and words come from `liveCardModel.ts`.
 */
import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text, useLines } from "./Text";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import {
  doneStops,
  hasTrack,
  liveLook,
  logLines,
  statusText,
  stepSummary,
  stopFractions,
  trackFraction,
  type LiveActivity,
} from "../liveCardModel";
import { botTestId } from "../botsModel";
import { Blob } from "./Blob";
import { CURVES } from "./blobShapes";
import { washStop } from "./contrast";
import { useBotTheme, useOnWash, useTheme } from "./theme";
import { fontFamily } from "./tokens";

const MAX_FONT_SCALE = 1.3;
const CHECK = "M5 12.5l4.5 4.5L19 7.5";
/** `transition: left 1s var(--spring)`. */
const SLIDE_MS = 1000;
const SLIDE_EASE = Easing.bezier(...CURVES.spring);

export interface LiveCardProps {
  activity: LiveActivity;
  /** Now, so "Working · 5 min" follows the clock. */
  now: number;
  /** A tap on the card (opens the task's link when it has one). Left out, the card is not pressable. */
  onPress?: () => void;
}

export function LiveCard({ activity, now, onPress }: LiveCardProps) {
  const t = useTheme().tokens;
  const look = useMemo(() => liveLook(activity), [activity]);
  const bt = useBotTheme(look);
  const onWash = useOnWash(bt.botWash, t.card);
  const wash = washStop(bt.botWash);
  const done = activity.state === "done";
  const running = activity.state === "running";
  const slug = botTestId("live-card", activity.botName);
  const status = statusText(activity, now);

  const body = (
    <>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
        <Defs>
          <LinearGradient id="liveWash" x1="0" y1="0" x2="1" y2="0.6">
            <Stop offset="0" stopColor={wash.rgb} stopOpacity={wash.alpha} />
            <Stop offset="0.75" stopColor={wash.rgb} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#liveWash)" />
      </Svg>

      <View style={styles.head}>
        <Blob bot={look} size={34} live={running && !hasTrack(activity)} still={!running} ring={t.avatarRing} />
        <View style={styles.name}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.nameText, { color: t.ink }]}>
            {activity.botName}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: onWash.ink3 }]}>
            {status}
          </Text>
        </View>
        {done ? (
          <View style={[styles.tick, { backgroundColor: t.okbg }]}>
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Path d={CHECK} fill="none" stroke={t.ok} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
        ) : null}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: t.ink }]}>
        {activity.title}
      </Text>

      {hasTrack(activity) ? (
        <Track activity={activity} testID={botTestId("live-track", activity.botName)} />
      ) : (
        <Log activity={activity} testID={botTestId("live-log", activity.botName)} />
      )}
    </>
  );

  const cardStyle = [styles.card, { backgroundColor: t.card, borderColor: t.line }];
  if (!onPress) {
    return (
      <View testID={slug} accessible accessibilityLabel={`${activity.botName}. ${status}. ${activity.title}`} style={cardStyle}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={slug}
      accessibilityRole="button"
      accessibilityLabel={`${activity.botName}. ${status}. ${activity.title}`}
      onPress={onPress}
      style={cardStyle}
    >
      {body}
    </Pressable>
  );
}

/** `.ltrack` with its stops, fill, rider, and the step line under it. */
function Track({
  activity,
  testID,
}: {
  activity: LiveActivity & { steps: string[]; stepIndex: number };
  testID: string;
}) {
  const t = useTheme().tokens;
  const look = useMemo(() => liveLook(activity), [activity]);
  const bt = useBotTheme(look);
  const stepLines = useLines(1);
  const reduced = useReducedMotion();
  const stops = stopFractions(activity.steps.length);
  const filled = doneStops(activity);
  const target = trackFraction(activity);
  const summary = stepSummary(activity);
  const running = activity.state === "running";

  // The blob and the fill slide together to the current stop, once, whenever it moves.
  const position = useSharedValue(target);
  useEffect(() => {
    position.value = reduced ? target : withTiming(target, { duration: SLIDE_MS, easing: SLIDE_EASE });
  }, [target, reduced, position]);
  const fill = useAnimatedStyle(() => ({ width: `${position.value * 100}%` }));
  const rider = useAnimatedStyle(() => ({ left: `${position.value * 100}%` }));

  return (
    <View testID={testID}>
      <View style={styles.track}>
        <View style={[styles.rail, { backgroundColor: t.fill2 }]} />
        <Animated.View style={[styles.fill, { backgroundColor: bt.mark }, fill]} />
        {stops.map((fraction, j) => (
          <View
            key={j}
            testID={`${testID}-stop-${j}`}
            style={[
              styles.stop,
              { left: `${fraction * 100}%` },
              j < filled ? { backgroundColor: bt.mark, borderColor: bt.mark } : { backgroundColor: t.card, borderColor: t.outline },
            ]}
          />
        ))}
        <Animated.View style={[styles.rider, rider]} pointerEvents="none">
          <Blob bot={look} size={30} live={running} still={!running} />
        </Animated.View>
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={stepLines} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.step, { color: t.ink }]}>
          {summary.step}
        </Text>
        {summary.toGo ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.toGo, { color: t.ink3 }]}>
            {summary.toGo}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** `.llog`: the last finished steps in grey with ticks, the current step in bold. */
function Log({ activity, testID }: { activity: LiveActivity; testID: string }) {
  const t = useTheme().tokens;
  const lines = logLines(activity);
  const pastLines = useLines(1);
  const currentLines = useLines(2);
  const done = activity.state === "done";
  const tick = (colour: string) => (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path d={CHECK} fill="none" stroke={colour} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
  return (
    <View testID={testID} style={styles.log}>
      {lines.finished.map((line, i) => (
        <View key={`${i}-${line}`} style={styles.logRow}>
          {tick(t.ink3)}
          <Text numberOfLines={pastLines} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.past, { color: t.ink3 }]}>
            {line}
          </Text>
        </View>
      ))}
      {lines.current !== "" ? (
        <View style={styles.logRow}>
          {done ? tick(t.ok) : null}
          <Text
            numberOfLines={currentLines}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.current, { color: done ? t.ok : t.ink }]}
          >
            {lines.current}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** `.livecard{border-radius:20px; border:1.5px; padding:14px 16px 16px; overflow:hidden}` */
  card: { borderRadius: 20, borderWidth: 1.5, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flexShrink: 1 },
  nameText: { fontFamily: fontFamily.extraBold, fontSize: 14, lineHeight: 17 },
  status: { fontFamily: fontFamily.bold, fontSize: 12.5, lineHeight: 15 },
  /** `.ldone{margin-left:auto; 24px}` */
  tick: { marginLeft: "auto", width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fontFamily.black, fontSize: 17, fontWeight: "900", marginTop: 10 },
  /** `.ltrack{height:36px; margin:12px 15px 0}` */
  track: { height: 36, marginTop: 12, marginHorizontal: 15 },
  rail: { position: "absolute", left: 0, right: 0, top: 16, height: 4, borderRadius: 2 },
  fill: { position: "absolute", left: 0, top: 16, height: 4, borderRadius: 2 },
  /** `.tdot{11px; border:2.5px; margin:-5.5px 0 0 -5.5px}` */
  stop: { position: "absolute", top: 12.5, width: 11, height: 11, marginLeft: -5.5, borderRadius: 5.5, borderWidth: 2.5 },
  /** `.lrider{margin:-16px 0 0 -15px; z-index:2}` */
  rider: { position: "absolute", top: 3, width: 30, height: 30, marginLeft: -15, zIndex: 2 },
  meta: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 6 },
  step: { flex: 1, fontFamily: fontFamily.extraBold, fontSize: 14.5 },
  toGo: { fontFamily: fontFamily.bold, fontSize: 14.5 },
  log: { marginTop: 8, gap: 5 },
  logRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  past: { flexShrink: 1, fontFamily: fontFamily.bold, fontSize: 13.5 },
  current: { flexShrink: 1, fontFamily: fontFamily.extraBold, fontSize: 15.5 },
});
