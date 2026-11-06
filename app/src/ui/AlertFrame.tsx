/**
 * The frame every alert screen shares (A1 to A3): the prototype's `.alert`, `.wash`, `.atop`,
 * `.amid`, `.abottom`, `.secrow`, `.pill`, `.exp`, `.ring`, `.who`, `.q`, `.msg`, `.more`,
 * `.details` and `.linkpill` in `vault/Projects/Puck/mockups/Puck prototype.html`.
 *
 * Top to bottom: the bot-coloured wash behind everything; a 34 dp top row (Reading aloud and
 * the queue counter on the left, the Urgent pill on the right); the scrolling middle (the blob
 * with two urgent rings, the who line, the expiry pill, the question, the message, Show more
 * with the details, the link); and the pinned bottom, which the screen fills with its options.
 *
 * The frame draws; the screen decides. It does not decide when it is night (`night` only
 * switches to the night tokens and glow), whether the phone is reading aloud, or what an
 * answer does.
 */
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { Blob, type BlobHandle } from "./Blob";
import type { BlobBot, Offset } from "./blobShapes";
import { Pill } from "./Pill";
import { RichText } from "./RichText";
import { ThemeProvider, useBotTheme, useTheme } from "./theme";
import { clockDateText, clockText } from "../localSettings";
import { fontFamily, radii } from "./tokens";

/** Paths copied from the prototype's `ICON` object (24 x 24 viewBox). */
export const ICON = {
  alarm: "M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 20a1.9 1.9 0 0 0 3.4 0",
  sound: "M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  check: "M5 12.5l4.5 4.5L19 7.5",
  clock: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2",
  reply: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  snooze: "M12 13m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 9v4l2.5 2.5M5 3L2 6M19 3l3 3",
  out: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
} as const;

export function Glyph({
  d,
  size,
  colour,
  width = 2.2,
}: {
  d: string;
  size: number;
  colour: string;
  width?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d={d} fill="none" stroke={colour} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Night screen background (`.night{background:#100F0E}`), which the prototype keeps outside the tokens. */
const NIGHT_BG = "#100F0E";
const MAX_FONT_SCALE = 1.3;
const EXPIRY_LOW_SECONDS = 300;

/* ------------------------------------------------------------------ time */

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "just now", "2 min ago", "1 h ago", "3 d ago". */
export function ageLabel(createdAt: number | undefined, now: number): string {
  if (createdAt === undefined) return "just now";
  const minutes = Math.floor(Math.max(0, now - createdAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export interface ExpiryView {
  /** "12 min left", "45 s left", or "Missed". */
  label: string;
  /** Share of the alert's life that is left, 0 to 1 (drives the short bar). */
  fraction: number;
  /** Under 5 minutes: the pill turns amber. */
  low: boolean;
  /** The time has passed: the alert can't be answered. */
  expired: boolean;
}

/**
 * Counts down to `expiresAt` once a second (prototype's `[data-exp]` ticker). The bar's full
 * length is the time from `createdAt` to `expiresAt`, or the time left when the screen opened
 * if `createdAt` is unknown. Returns null for an alert that never expires.
 */
export function useExpiry(expiresAt: number | undefined, createdAt?: number): ExpiryView | null {
  const now = useNow(1000);
  const [opened] = useState(() => Date.now());
  if (expiresAt === undefined) return null;
  const total = Math.max(1000, expiresAt - (createdAt ?? opened));
  const remaining = Math.max(0, expiresAt - now);
  const seconds = remaining / 1000;
  const expired = remaining <= 0;
  const label = expired
    ? "Missed"
    : seconds >= 60
      ? `${Math.ceil(seconds / 60)} min left`
      : `${Math.ceil(seconds)} s left`;
  return {
    label,
    fraction: Math.min(1, remaining / total),
    low: expired || seconds < EXPIRY_LOW_SECONDS,
    expired,
  };
}

/* ------------------------------------------------------------------ wash */

function parseRgba(colour: string): { rgb: string; alpha: number } {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(colour);
  if (!m) return { rgb: colour, alpha: 1 };
  return { rgb: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

/**
 * `.alert .wash`: `radial-gradient(120% 60% at 50% 18%, wash 0%, transparent 62%)`; at night
 * `radial-gradient(90% 46% at 50% 34%, glow 0%, transparent 70%)`.
 */
export function Wash({ colour, night }: { colour: string; night: boolean }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);
  const { rgb, alpha } = parseRgba(colour);
  const shape = night
    ? { cx: 0.5, cy: 0.34, rx: 0.9, ry: 0.46, stop: 0.7 }
    : { cx: 0.5, cy: 0.18, rx: 1.2, ry: 0.6, stop: 0.62 };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size ? (
        <Svg width={size.w} height={size.h} accessible={false}>
          <Defs>
            <RadialGradient
              id="wash"
              gradientUnits="userSpaceOnUse"
              cx={shape.cx * size.w}
              cy={shape.cy * size.h}
              rx={shape.rx * size.w}
              ry={shape.ry * size.h}
            >
              <Stop offset={0} stopColor={rgb} stopOpacity={alpha} />
              <Stop offset={shape.stop} stopColor={rgb} stopOpacity={0} />
              <Stop offset={1} stopColor={rgb} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#wash)" />
        </Svg>
      ) : null}
    </View>
  );
}

/* ----------------------------------------------------------------- rings */

const RING_SIZE = 150;
const RING_MS = 1400;
const RING_EASE = Easing.bezier(0, 0, 0.58, 1); // CSS ease-out

/** `.ring`: `pulse 1.4s ease-out infinite`, scale .9 to 1.65 and opacity .45 to 0; `.r2` starts .7 s later. */
function Ring({ colour, delay }: { colour: string; delay: number }) {
  const progress = useSharedValue(1);
  useEffect(() => {
    progress.value = 1;
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: RING_MS, easing: RING_EASE })),
        -1,
      ),
    );
    return () => cancelAnimation(progress);
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: 0.9 + 0.75 * progress.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { borderColor: colour },
        style,
      ]}
    />
  );
}

/** Two rings, 0.7 s apart. Not drawn with reduced motion (the prototype stops its animations). */
function UrgentRings({ colour }: { colour: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <>
      <Ring colour={colour} delay={0} />
      <Ring colour={colour} delay={RING_MS / 2} />
    </>
  );
}

/* ----------------------------------------------------------------- parts */

/** `.lockclock` and `.lockdate`: the time and date, as a call screen shows them. */
function LockClock({ now }: { now: number }) {
  const t = useTheme().tokens;
  const date = new Date(now);
  return (
    <View
      accessible
      accessibilityLabel={`${clockText(date)}, ${clockDateText(date)}`}
      style={styles.lockClock}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          color: t.ink,
          fontFamily: fontFamily.extraBold,
          fontSize: 64,
          fontWeight: "800",
          letterSpacing: -0.02 * 64,
          lineHeight: 64,
        }}
      >
        {clockText(date)}
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ color: t.ink2, fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700", marginTop: 6 }}
      >
        {clockDateText(date)}
      </Text>
    </View>
  );
}

function ExpiryPill({ expiry }: { expiry: ExpiryView }) {
  const t = useTheme().tokens;
  const reduced = useReducedMotion();
  const colour = expiry.low ? t.warn : t.ink2;
  const width = useSharedValue(expiry.fraction);
  useEffect(() => {
    width.value = reduced ? expiry.fraction : withTiming(expiry.fraction, { duration: 1000, easing: Easing.linear });
  }, [expiry.fraction, reduced, width]);
  const bar = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View
      accessible
      accessibilityLabel={expiry.expired ? "Missed" : `Expires in ${expiry.label.replace(" left", "")}`}
      style={[styles.exp, { backgroundColor: expiry.low ? t.warnbg : t.fill }]}
    >
      <Glyph d={ICON.clock} size={14} colour={colour} width={2.4} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.expText, { color: colour }]}>
        {expiry.label}
      </Text>
      <View style={[styles.expTrack, { backgroundColor: t.fill2 }]}>
        <Animated.View style={[styles.expFill, { backgroundColor: colour }, bar]} />
      </View>
    </View>
  );
}

/** `.secrow`: Reply and Snooze in one quiet row. */
export function AlertSecondaryRow({
  onReply,
  onSnooze,
}: {
  onReply: () => void;
  /** Left out on a one-option swipe, which has Snooze on the track. */
  onSnooze?: () => void;
}) {
  const t = useTheme().tokens;
  const button = (label: string, icon: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      style={({ pressed }) => [styles.secButton, pressed ? { backgroundColor: t.fill } : null]}
    >
      <Glyph d={icon} size={19} colour={t.ink2} width={2.1} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.secText, { color: t.ink2 }]}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.secRow}>
      {button("Reply", ICON.reply, onReply)}
      {onSnooze ? button("Snooze", ICON.snooze, onSnooze) : null}
    </View>
  );
}

/* ----------------------------------------------------------------- frame */

export interface AlertFrameProps {
  bot: BlobBot;
  priority: "normal" | "urgent";
  question: string;
  /** Epoch ms the alert came in; feeds "2 min ago" and the expiry bar. */
  createdAt?: number;
  message?: string;
  details?: string;
  link?: { label: string; url: string };
  onOpenLink?: () => void;
  /** From `useExpiry`; null or left out when the alert never expires. */
  expiry?: ExpiryView | null;
  /** The pill under the top row's left edge. The screen sets it only while it is really reading aloud. */
  readingAloud?: boolean;
  /** "1 of 3" when more alerts are waiting. */
  queue?: { position: number; total: number } | null;
  /** Switches to the night tokens and the glow. The caller decides when it is night. */
  night?: boolean;
  /** The lock-screen clock at the top (`.lockclock`, `.lockdate`). The caller decides: an urgent alert over the lock screen. */
  clock?: boolean;
  /** The answer is in: the message, details, link and expiry go and the rings stop. */
  answered?: boolean;
  /** Lets the screen fire the blob's reactions (squash, leap and so on). */
  blobRef?: RefObject<BlobHandle | null>;
  /** Defaults to 156, the prototype's size with no option descriptions. */
  blobSize?: number;
  look?: Offset | null;
  /** Pinned at the bottom: hint, options, the Reply and Snooze row. */
  bottom: ReactNode;
  /** Drawn over everything (a Toast, the A9 card). */
  overlay?: ReactNode;
  /** A9: the alert is gone. Everything but the overlay goes grey (`.dim`: opacity .35) and takes no touches. */
  dimmed?: boolean;
}

export function AlertFrame(props: AlertFrameProps) {
  const body = <AlertFrameBody {...props} />;
  return props.night ? <ThemeProvider mode="night">{body}</ThemeProvider> : body;
}

function AlertFrameBody({
  bot,
  priority,
  question,
  createdAt,
  message,
  details,
  link,
  onOpenLink,
  expiry,
  readingAloud = false,
  queue,
  night = false,
  clock = false,
  answered = false,
  blobRef,
  blobSize = 156,
  look,
  bottom,
  overlay,
  dimmed = false,
}: AlertFrameProps) {
  const { tokens: t, dark, night: nightMode } = useTheme();
  const bt = useBotTheme(bot);
  const now = useNow(15000);
  const [expanded, setExpanded] = useState(false);
  const urgent = priority === "urgent";
  const ownBlob = useRef<BlobHandle>(null);
  const blob = blobRef ?? ownBlob;
  // `blob.arrive` on open (the prototype renders the unstacked blob with `arrive`).
  useLayoutEffect(() => {
    blob.current?.arrive();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showMore = Boolean(details) && !answered;
  const dotRing = nightMode || (dark && bot.colour === "black") ? "#5A5754" : null;
  const top = (StatusBar.currentHeight ?? 24) + 8;

  return (
    <View style={[styles.screen, { backgroundColor: nightMode ? NIGHT_BG : t.bg }]}>
      <Wash colour={nightMode ? bt.glow : bt.botWash} night={nightMode} />
      <View style={[styles.content, { paddingTop: top }]}>
        <View style={styles.atop}>
          <View style={styles.atopSide}>
            {readingAloud && !answered ? (
              <Pill icon={<Glyph d={ICON.sound} size={14} colour={t.ink2} />}>Reading aloud</Pill>
            ) : null}
            {queue && queue.total > 1 ? (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{ color: t.ink2, fontFamily: fontFamily.extraBold, fontSize: 13 }}
              >
                {queue.position} of {queue.total}
              </Text>
            ) : null}
          </View>
          {urgent ? (
            <Pill urgent icon={<Glyph d={ICON.alarm} size={14} colour={t.danger} />}>
              Urgent
            </Pill>
          ) : null}
        </View>

        <ScrollView
          style={[styles.amid, dimmed ? styles.dim : null]}
          pointerEvents={dimmed ? "none" : "auto"}
          contentContainerStyle={styles.amidContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {clock ? <LockClock now={now} /> : null}

          <View style={styles.ablob}>
            {urgent && !answered ? <UrgentRings colour={nightMode ? bt.glowRing : bt.bot} /> : null}
            <Blob ref={blob} bot={bot} size={blobSize} live look={look} />
          </View>

          <View style={styles.who} accessible accessibilityLabel={`${bot.name}, ${ageLabel(createdAt, now)}`}>
            <View
              style={[
                styles.dot,
                { backgroundColor: bt.bot },
                dotRing ? styles.dotRing : null,
                dotRing ? { borderColor: dotRing } : null,
              ]}
            />
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.whoName, { color: t.ink }]}
            >
              {bot.name}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.whoAge, { color: t.ink3 }]}>
              · {ageLabel(createdAt, now)}
            </Text>
          </View>

          {expiry && !answered ? <ExpiryPill expiry={expiry} /> : null}

          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.question, { color: t.ink }]}
          >
            {question}
          </Text>

          {message && !answered ? (
            <View style={styles.msg}>
              <RichText
                text={message}
                style={{
                  fontFamily: fontFamily.semiBold,
                  fontSize: 16,
                  fontWeight: "600",
                  lineHeight: 16 * 1.45,
                  textAlign: "center",
                  color: t.ink2,
                }}
              />
            </View>
          ) : null}

          {showMore ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded((open) => !open)}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                style={styles.more}
              >
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[
                    styles.moreText,
                    { color: t.ink, textDecorationColor: t.edge },
                  ]}
                >
                  {expanded ? "Show less" : "Show more"}
                </Text>
              </Pressable>
              {expanded ? (
                <Animated.View
                  entering={FadeInDown.duration(200)}
                  style={[styles.details, { backgroundColor: t.fill }]}
                >
                  <Text
                    selectable
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={[styles.detailsText, { color: t.ink2 }]}
                  >
                    {details}
                  </Text>
                </Animated.View>
              ) : null}
            </>
          ) : null}

          {link && !answered ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={link.label}
              onPress={onOpenLink}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.linkPill, { backgroundColor: t.card, borderColor: t.line }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: t.ink2 }]}>
                {link.label}
              </Text>
              <Glyph d={ICON.out} size={13} colour={t.ink2} width={2.4} />
            </Pressable>
          ) : null}

          <View style={styles.spacer} />
        </ScrollView>

        <View
          style={[styles.abottom, dimmed ? styles.dim : null]}
          pointerEvents={dimmed ? "none" : "auto"}
          importantForAccessibility={dimmed ? "no-hide-descendants" : "auto"}
        >
          {bottom}
        </View>
      </View>
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  /** `.dim{opacity:.35; pointer-events:none; filter:grayscale(.4)}` */
  dim: { opacity: 0.35, filter: [{ grayscale: 0.4 }] },
  content: { flex: 1 },
  atop: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  atopSide: { flexDirection: "row", alignItems: "center", gap: 10 },
  amid: { flex: 1, minHeight: 0 },
  amidContent: { flexGrow: 1, alignItems: "center", paddingHorizontal: 28 },
  lockClock: { alignItems: "center", marginTop: 2 },
  ablob: { marginVertical: 18, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: RING_SIZE,
    height: RING_SIZE,
    marginLeft: -RING_SIZE / 2,
    marginTop: -RING_SIZE / 2,
    borderRadius: RING_SIZE / 2,
    borderWidth: 3,
  },
  who: { flexDirection: "row", alignItems: "center", gap: 7, maxWidth: "100%" },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  // `box-shadow: 0 0 0 1.5px` around the dot: a 12 dp circle with a 1.5 dp border, pulled back by its margin.
  dotRing: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, margin: -1.5 },
  whoName: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  whoAge: { fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700" },
  exp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  expText: { fontFamily: fontFamily.extraBold, fontSize: 13, fontWeight: "800" },
  expTrack: { width: 40, height: 4, borderRadius: 2, overflow: "hidden" },
  expFill: { height: "100%" },
  question: {
    fontFamily: fontFamily.extraBold,
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 30 * 1.14,
    letterSpacing: 30 * -0.015,
    textAlign: "center",
    marginTop: 12,
  },
  msg: { marginTop: 12 },
  more: { marginTop: 10 },
  moreText: {
    fontFamily: fontFamily.extraBold,
    fontSize: 15,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  details: { width: "100%", marginTop: 14, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  detailsText: { fontFamily: "monospace", fontSize: 13, fontWeight: "600", lineHeight: 13 * 1.55, textAlign: "left" },
  linkPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    minHeight: 32,
    paddingHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1,
  },
  linkText: { fontFamily: fontFamily.extraBold, fontSize: 14, fontWeight: "800" },
  spacer: { flex: 1, minHeight: 14 },
  abottom: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 22 },
  secRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 14, paddingHorizontal: 6, paddingBottom: 8 },
  secButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 8,
    borderRadius: radii.row,
  },
  secText: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800" },
});
