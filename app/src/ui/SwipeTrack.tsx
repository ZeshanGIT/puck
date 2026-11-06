/**
 * The swipe track of A3: the prototype's `.track`, `.knob`, `.tint`, `.side` and `wireSwipe()`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`).
 *
 * - A 78 dp pill with the answer on each side and a 66 dp live blob (the knob) in the middle.
 *   The knob travels `width/2 - 40` each way, tilts `offset/travel * 10` degrees and commits when it
 *   is let go past 72% of the travel (`swipe.ts` holds those numbers and their tests).
 * - The side being dragged toward is tinted, fading in with the distance; its label darkens past
 *   the mark. Toward a destructive side the knob blends to `#D93A2E`, reaching full red at 80% of
 *   the travel (`min(1, p * 1.25)`).
 * - The drag is a Gesture Handler pan on the UI thread. The knob is ignored for 400 ms after the
 *   track mounts (the arm delay) and a drag whose first reading is already past the mark is
 *   ignored (the stale-touch guard). A haptic tick marks crossing the mark.
 * - Tap twice: tapping a side's label arms it (the `ArmTimer` bar drains for 4 s) and a second tap
 *   commits it, so the track works without dragging. The labels are also the screen reader's
 *   route: the knob exposes one custom action per side, and each action is the same tap twice.
 * - A release past the mark rests at the end for 160 ms, then `onCommit(side)` is called once.
 *   `reset()` on the ref springs the knob home and re-arms the track (a failed send, or a
 *   snooze that only opened a sheet).
 *
 * The track decides nothing about what a side means: the screen maps the side to an answer or to
 * Puck's Snooze. Colours come from the theme hooks, apart from the danger red and the night face,
 * which the prototype hard-codes (`RED`, `.night .track`).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import {
  SWIPE_COMMIT_DELAY_MS,
  SWIPE_COMMIT_FRACTION,
  SWIPE_MIN_DRAG_PX,
  type SwipeSide,
  swipeArmDelayLeft,
  swipeClamp,
  swipeDangerBlend,
  swipeDragMayBegin,
  swipeMax,
  swipeProgress,
  swipeRotation,
  swipeSideAt,
} from "../swipe";
import { ArmTimer } from "./ArmTimer";
import {
  CURVES,
  EYES,
  EYE_GROUP_ORIGIN,
  EYE_GROUP_ROTATION,
  SHAPES,
  type BlobBot,
  type Offset,
} from "./blobShapes";
import { useBotTheme, useTheme } from "./theme";
import { fontFamily } from "./tokens";
import { haptics, TapTwiceGroup, useTapTwice } from "./useTapTwice";
import { useBlobLife } from "./useBlobLife";

export type { SwipeSide } from "../swipe";

/** What a side is for. `destructive` is red (Roll back); `snooze` is Puck's own Snooze (quiet grey tint). */
export type SwipeSideTone = "destructive" | "snooze";

export interface SwipeSideSpec {
  label: string;
  /** An SVG path in a 24 x 24 box (stroke icon), drawn 20 dp beside the label. */
  icon?: string;
  tone?: SwipeSideTone;
}

export interface SwipeTrackHandle {
  /** Springs the knob home, forgets any commit and re-arms the track. */
  reset(): void;
}

export interface SwipeTrackProps {
  left: SwipeSideSpec;
  right: SwipeSideSpec;
  /** The bot whose blob is the knob. */
  bot: BlobBot;
  /** Called once with the side the answer committed to, by drag (after 160 ms) or by tapping twice. */
  onCommit: (side: SwipeSide) => void;
  /**
   * The way the drag leans: -1 left, 1 right, 0 exactly in the middle, null when the knob went
   * home. The screen points its own blob the same way (`look(big, dir*4, 3)`).
   */
  onLookChange?: (direction: -1 | 0 | 1 | null) => void;
  /** A side was armed by a first tap (the screen shows "Tap again to choose ..."), or null when none is. */
  onArm?: (side: SwipeSide | null) => void;
  /** Dimmed and not draggable or tappable (the alert expired). */
  disabled?: boolean;
}

/** `RED` in `wireSwipe()`. */
const DANGER_RED = "#D93A2E";
/** The black bot's knob starts from this grey, not near-black, when it blends to red (`base==="#111111"?"#3A3836":base`). */
const BLACK_BLEND_START = "#3A3836";
/** `.night .opt, .night .track`: the prototype keeps the night face outside the tokens. */
const NIGHT_FACE = "#1C1A18";
const NIGHT_LINE = "#2C2926";
const DISABLED_OPACITY = 0.32;
const MAX_FONT_SCALE = 1.3;

const TRACK_HEIGHT = 78;
const TRACK_BORDER = 1.5;
const KNOB_SIZE = 66;
/** `.knob{transition: transform .5s var(--spring)}` */
const KNOB_MS = 500;
const LABEL_COLOUR_MS = 150;
const LOOK_X = 4;
const KNOB_EYE_UNIT = KNOB_SIZE / 100;
const FAIL_OFFSET_Y = 12;
const SPRING_EASING = Easing.bezier(...CURVES.spring);
const NO_LOOK = 2;

const AnimatedPath = Animated.createAnimatedComponent(Path);

function parseRgba(colour: string): { rgb: string; alpha: number } {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(colour);
  if (!m) return { rgb: colour, alpha: 1 };
  return { rgb: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

/* ------------------------------------------------------------------ pieces */

/** `.tint`: half the track, a gradient from the tint to nothing, drawn at opacity `progress` toward its side. */
function Tint({ side, colour, opacity }: { side: SwipeSide; colour: string; opacity: SharedValue<number> }) {
  const id = useId().replace(/\W/g, "");
  const { rgb, alpha } = parseRgba(colour);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const left = side === "left";
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.tint, left ? styles.tintLeft : styles.tintRight, style]}
    >
      <Svg width="100%" height="100%" accessible={false}>
        <Defs>
          <LinearGradient id={id} x1={left ? 0 : 1} y1={0} x2={left ? 1 : 0} y2={0}>
            <Stop offset={0} stopColor={rgb} stopOpacity={alpha} />
            <Stop offset={1} stopColor={rgb} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** `.side` text and icon: ink2, and `hot` (0 to 1, eased over .15 s) blends it to the side's strong colour. */
function SideContent({
  spec,
  side,
  hot,
  rest,
  strong,
}: {
  spec: SwipeSideSpec;
  side: SwipeSide;
  hot: SharedValue<number>;
  rest: string;
  strong: string;
}) {
  const textStyle = useAnimatedStyle(() => ({ color: interpolateColor(hot.value, [0, 1], [rest, strong]) }));
  const iconProps = useAnimatedProps(() => ({ stroke: interpolateColor(hot.value, [0, 1], [rest, strong]) }));
  const icon = spec.icon ? (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
      <AnimatedPath
        d={spec.icon}
        fill="none"
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        animatedProps={iconProps}
      />
    </Svg>
  ) : null;
  return (
    <View style={[styles.sideRow, side === "left" ? styles.sideRowLeft : styles.sideRowRight]}>
      {side === "left" ? icon : null}
      <Animated.Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.sideText, textStyle]}
      >
        {spec.label}
      </Animated.Text>
      {side === "right" ? icon : null}
    </View>
  );
}

/**
 * The knob: the bot's blob at 66 dp, ported from the live blob (`Blob.tsx`) with one change, the
 * body fill is animated so it can blend to red on the UI thread. Eyes glance and blink and turn
 * toward `look`.
 */
function KnobBlob({
  bot,
  look,
  fill,
}: {
  bot: BlobBot;
  look: Offset | null;
  fill: ReturnType<typeof useAnimatedProps>;
}) {
  const bt = useBotTheme(bot);
  const { eyeX, eyeY, eyeScaleY } = useBlobLife(true, look);
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: eyeX.value * KNOB_EYE_UNIT }, { translateY: eyeY.value * KNOB_EYE_UNIT }],
  }));
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: eyeScaleY.value }] }));
  return (
    <View pointerEvents="none" style={styles.blob}>
      <Svg width={KNOB_SIZE} height={KNOB_SIZE} viewBox="0 0 100 100" style={styles.blobSvg} accessible={false}>
        <G transform={`rotate(${bot.tilt} 50 50)`}>
          <AnimatedPath
            d={SHAPES[bot.shape]}
            stroke={bt.blobOutline ?? undefined}
            strokeWidth={bt.blobOutline ? 2 : undefined}
            animatedProps={fill}
          />
        </G>
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, eyesStyle]}>
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              transformOrigin: `${EYE_GROUP_ORIGIN.x}% ${EYE_GROUP_ORIGIN.y}%`,
              transform: [{ rotate: `${EYE_GROUP_ROTATION}deg` }],
            },
          ]}
        >
          {EYES.map((e) => (
            <Animated.View
              key={e.x}
              style={[
                {
                  position: "absolute",
                  left: e.x * KNOB_EYE_UNIT,
                  top: e.y * KNOB_EYE_UNIT,
                  width: e.width * KNOB_EYE_UNIT,
                  height: e.height * KNOB_EYE_UNIT,
                  borderRadius: e.rx * KNOB_EYE_UNIT,
                  backgroundColor: "#fff",
                },
                eyeStyle,
              ]}
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/* ------------------------------------------------------------------- track */

export const SwipeTrack = forwardRef<SwipeTrackHandle, SwipeTrackProps>(function SwipeTrack(props, ref) {
  // One arm slot for the track: arming one label disarms the other.
  return (
    <TapTwiceGroup>
      <TrackBody {...props} handleRef={ref} />
    </TapTwiceGroup>
  );
});

function TrackBody({
  left,
  right,
  bot,
  onCommit,
  onLookChange,
  onArm,
  disabled = false,
  handleRef,
}: SwipeTrackProps & { handleRef: React.ForwardedRef<SwipeTrackHandle> }) {
  const { tokens: t, dark, night } = useTheme();
  const bt = useBotTheme(bot);
  const reduced = useReducedMotion();

  // Shared state the gesture reads and writes on the UI thread.
  const max = useSharedValue(0);
  /** Where the knob is drawn; eased home or to the end on release. */
  const x = useSharedValue(0);
  /** Where the knob is "logically": set at once, and everything but the knob's position follows it. */
  const drive = useSharedValue(0);
  const enabled = useSharedValue(false);
  const committed = useSharedValue(false);
  const ignoring = useSharedValue(false);
  const lastLean = useSharedValue(NO_LOOK);
  const pastMark = useSharedValue(false);
  /** -1 or 1 while a label is armed by tapping, else 0. */
  const armedSide = useSharedValue(0);

  // JS state.
  const opened = useRef(Date.now());
  const [ready, setReady] = useState(false);
  const [knobLook, setKnobLook] = useState<Offset | null>(null);
  const settled = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onCommit, onLookChange, onArm });
  callbacks.current = { onCommit, onLookChange, onArm };

  // The arm delay: nothing answers for 400 ms after the track appears.
  useEffect(() => {
    const id = setTimeout(() => setReady(true), swipeArmDelayLeft(opened.current, Date.now()));
    return () => clearTimeout(id);
  }, []);
  const active = ready && !disabled;
  useEffect(() => {
    enabled.value = active;
  }, [active, enabled]);
  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  const finish = useCallback(
    (side: SwipeSide, byDrag: boolean) => {
      if (settled.current) return;
      settled.current = true;
      committed.value = true;
      // Tapping twice already gave its confirm haptic (`useTapTwice`).
      if (byDrag) haptics.confirm();
      callbacks.current.onCommit(side);
    },
    [committed],
  );

  const lean = useCallback((direction: -1 | 0 | 1 | null) => {
    setKnobLook(direction === null ? null : { x: direction * LOOK_X, y: 0 });
    callbacks.current.onLookChange?.(direction);
  }, []);
  const tick = useCallback(() => haptics.tick(), []);
  const commitSoon = useCallback(
    (side: SwipeSide) => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => finish(side, true), SWIPE_COMMIT_DELAY_MS);
    },
    [finish],
  );

  const settle = (to: number) => {
    "worklet";
    x.value = reduced ? to : withTiming(to, { duration: KNOB_MS, easing: SPRING_EASING });
  };

  const pan = usePanGesture({
    enabled,
    activeOffsetX: [-SWIPE_MIN_DRAG_PX, SWIPE_MIN_DRAG_PX],
    failOffsetY: [-FAIL_OFFSET_Y, FAIL_OFFSET_Y],
    onActivate: (e) => {
      "worklet";
      // The stale-touch guard: a touch that is first read already past the mark is not a drag.
      ignoring.value = committed.value || !swipeDragMayBegin(e.translationX, e.translationY, max.value);
      if (!ignoring.value) cancelAnimation(x);
    },
    onUpdate: (e) => {
      "worklet";
      if (ignoring.value || committed.value) return;
      const v = swipeClamp(e.translationX, max.value);
      drive.value = v;
      x.value = v;
      const lean_ = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (lean_ !== lastLean.value) {
        lastLean.value = lean_;
        scheduleOnRN(lean, lean_);
      }
      const past = swipeSideAt(v, max.value) !== null;
      if (past && !pastMark.value) scheduleOnRN(tick);
      pastMark.value = past;
    },
    onDeactivate: (e) => {
      "worklet";
      if (ignoring.value) {
        ignoring.value = false;
        return;
      }
      pastMark.value = false;
      const side = e.canceled || committed.value ? null : swipeSideAt(drive.value, max.value);
      if (side) {
        const end = side === "right" ? max.value : -max.value;
        drive.value = end;
        settle(end);
        scheduleOnRN(commitSoon, side);
      } else if (!committed.value) {
        drive.value = 0;
        settle(0);
        lastLean.value = NO_LOOK;
        scheduleOnRN(lean, null);
      }
    },
  });

  useImperativeHandle(
    handleRef,
    () => ({
      reset() {
        if (commitTimer.current) clearTimeout(commitTimer.current);
        settled.current = false;
        committed.value = false;
        ignoring.value = false;
        pastMark.value = false;
        lastLean.value = NO_LOOK;
        drive.value = 0;
        x.value = reduced ? 0 : withTiming(0, { duration: KNOB_MS, easing: SPRING_EASING });
        lean(null);
      },
    }),
    [committed, ignoring, pastMark, lastLean, drive, x, reduced, lean],
  );

  // Tap twice on the labels.
  const leftTwice = useTapTwice({ onConfirm: () => finish("left", false) });
  const rightTwice = useTapTwice({ onConfirm: () => finish("right", false) });
  const armed: SwipeSide | null = leftTwice.armed ? "left" : rightTwice.armed ? "right" : null;
  useEffect(() => {
    armedSide.value = armed === "left" ? -1 : armed === "right" ? 1 : 0;
    callbacks.current.onArm?.(armed);
  }, [armed, armedSide]);
  const { disarm: disarmLeft } = leftTwice;
  const { disarm: disarmRight } = rightTwice;
  useEffect(() => {
    if (!active) {
      disarmLeft();
      disarmRight();
    }
  }, [active, disarmLeft, disarmRight]);

  const press = (side: SwipeSide) => {
    if (!active || settled.current) return;
    (side === "left" ? leftTwice : rightTwice).press();
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === "left" || name === "right") press(name);
  };

  // Look.
  const leftDanger = left.tone === "destructive";
  const rightDanger = right.tone === "destructive";
  const blendFrom = bot.colour === "black" ? BLACK_BLEND_START : bt.bot;
  const baseFill = bt.bot;

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: `${swipeRotation(x.value, max.value)}deg` }],
  }));
  const knobFill = useAnimatedProps(() => {
    const toward = drive.value < 0 ? leftDanger : drive.value > 0 ? rightDanger : false;
    return {
      fill: toward
        ? interpolateColor(swipeDangerBlend(drive.value, max.value), [0, 1], [blendFrom, DANGER_RED])
        : baseFill,
    };
  });
  const leftTint = useDerivedValue(() => (drive.value < 0 ? swipeProgress(drive.value, max.value) : 0));
  const rightTint = useDerivedValue(() => (drive.value > 0 ? swipeProgress(drive.value, max.value) : 0));
  const leftHot = useDerivedValue<number>(() => {
    const on = drive.value < -max.value * SWIPE_COMMIT_FRACTION || armedSide.value === -1;
    return reduced ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: LABEL_COLOUR_MS });
  });
  const rightHot = useDerivedValue<number>(() => {
    const on = drive.value > max.value * SWIPE_COMMIT_FRACTION || armedSide.value === 1;
    return reduced ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: LABEL_COLOUR_MS });
  });

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      max.value = swipeMax(e.nativeEvent.layout.width - 2 * TRACK_BORDER);
    },
    [max],
  );

  const tint = (tone: SwipeSideTone | undefined) =>
    tone === "destructive" ? t.dangerbg : tone === "snooze" ? t.fill2 : bt.botTint;
  const strong = (tone: SwipeSideTone | undefined) => (tone === "destructive" ? t.danger : t.ink);
  const barColour = (tone: SwipeSideTone | undefined) =>
    tone === "destructive" ? t.danger : dark ? bt.botLight : bt.bot;

  const actions = useMemo(
    () => [
      { name: "left", label: left.label },
      { name: "right", label: right.label },
    ],
    [left.label, right.label],
  );

  const sideButton = (side: SwipeSide, spec: SwipeSideSpec, hot: SharedValue<number>) => {
    const isArmed = armed === side;
    return (
      <Pressable
        key={side}
        accessibilityRole="button"
        accessibilityLabel={spec.label}
        accessibilityHint={isArmed ? "Tap again to confirm" : "Tap twice to choose"}
        accessibilityState={{ disabled: !active, selected: isArmed }}
        onPress={() => press(side)}
        style={[styles.side, side === "left" ? styles.sideLeft : styles.sideRight]}
      >
        <SideContent spec={spec} side={side} hot={hot} rest={t.ink2} strong={strong(spec.tone)} />
        {isArmed ? (
          <View pointerEvents="none" style={[styles.armBox, side === "left" ? styles.armBoxLeft : styles.armBoxRight]}>
            <ArmTimer color={barColour(spec.tone)} armedAt={(side === "left" ? leftTwice : rightTwice).armedAt} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.track,
        {
          backgroundColor: night ? NIGHT_FACE : t.fill,
          borderColor: night ? NIGHT_LINE : t.line,
        },
        disabled ? { opacity: DISABLED_OPACITY } : null,
      ]}
    >
      <Tint side="left" colour={tint(left.tone)} opacity={leftTint} />
      <Tint side="right" colour={tint(right.tone)} opacity={rightTint} />
      {sideButton("left", left, leftHot)}
      {sideButton("right", right, rightHot)}
      <GestureDetector gesture={pan}>
        <Animated.View
          accessible
          accessibilityLabel={`Swipe toward ${left.label} or ${right.label}`}
          accessibilityHint="Drag the knob, or choose an action"
          accessibilityActions={actions}
          onAccessibilityAction={onAccessibilityAction}
          accessibilityState={{ disabled: !active }}
          style={[styles.knob, knobStyle]}
        >
          <KnobBlob bot={bot} look={knobLook} fill={knobFill} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: "relative",
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: TRACK_BORDER,
    overflow: "hidden",
  },
  tint: { position: "absolute", top: 0, bottom: 0, width: "50%" },
  tintLeft: { left: 0 },
  tintRight: { right: 0 },
  side: { position: "absolute", top: 0, bottom: 0, width: "50%", justifyContent: "center" },
  sideLeft: { left: 0, paddingLeft: 24 },
  sideRight: { right: 0, paddingRight: 24 },
  sideRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sideRowLeft: { justifyContent: "flex-start" },
  sideRowRight: { justifyContent: "flex-end" },
  sideText: { fontFamily: fontFamily.extraBold, fontSize: 17, fontWeight: "800", flexShrink: 1 },
  // The bar clears the knob: the half's inner edge next to the middle is kept 36 dp free.
  armBox: { position: "absolute", top: 0, bottom: 0 },
  armBoxLeft: { left: 4, right: 36 },
  armBoxRight: { left: 36, right: 4 },
  knob: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    marginTop: -KNOB_SIZE / 2,
    marginLeft: -KNOB_SIZE / 2,
    zIndex: 2,
  },
  blob: { width: KNOB_SIZE, height: KNOB_SIZE },
  blobSvg: { overflow: "visible", position: "absolute", top: 0, left: 0 },
});
