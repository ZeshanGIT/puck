/**
 * The bot blob, ported from the prototype's `blob()` and `.blob` CSS in
 * `vault/Projects/Puck/mockups/Puck prototype.html`.
 *
 * - A 100 x 100 viewBox: the `SHAPES[shape]` body rotated by the bot's tilt about
 *   (50, 50), and two white eyes in a group rotated -12 degrees about (66, 36).
 * - `live` (alert screens only) runs glance and blink. Without `live` the blob is
 *   still: a plain SVG with no timers or animated values, for lists at 18 to 44 px.
 * - `look` points the eyes (viewBox units) and pauses glancing and blinking.
 * - The ref fires the reactions `arrive`, `squash`, `leap`, `droop` and `hop`,
 *   about 50% across and 90% down. Reactions need a live blob; on a still blob
 *   they do nothing.
 *
 * In the live blob the body is SVG and the eyes are rounded views layered on top,
 * so the glance, blink and reactions animate as native transforms on the UI thread.
 */
import { forwardRef, useImperativeHandle } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { G, Path, Rect } from "react-native-svg";
import {
  CURVES,
  EYES,
  EYE_GROUP_ORIGIN,
  EYE_GROUP_ROTATION,
  REACTIONS,
  REACTION_ORIGIN,
  REDUCED_FADE_MS,
  SHAPES,
  reactionSegments,
  type BlobBot,
  type CurveName,
  type Offset,
  type ReactionName,
} from "./blobShapes";
import { useBotTheme } from "./theme";
import { useBlobLife } from "./useBlobLife";

export interface BlobHandle {
  arrive(): void;
  squash(): void;
  leap(): void;
  droop(): void;
  hop(): void;
}

export interface BlobProps {
  bot: BlobBot;
  /** Width and height in dp. */
  size: number;
  /** Glance and blink (alert screens, B4, B5 and live activities). */
  live?: boolean;
  /** Static blob with no timers. The default when `live` isn't set; wins over `live`. */
  still?: boolean;
  /** Eyes look toward this offset (viewBox units, about +-4 x, +-4 y); glancing pauses. */
  look?: Offset | null;
}

const EYE_FILL = "#fff";
const OUTLINE_WIDTH = 2;

const EASINGS: Record<CurveName, ReturnType<typeof Easing.bezier>> = {
  spring: Easing.bezier(...CURVES.spring),
  ease: Easing.bezier(...CURVES.ease),
  easeOut: Easing.bezier(...CURVES.easeOut),
  easeInOut: Easing.bezier(...CURVES.easeInOut),
};

/**
 * Body fill and outline. The prototype's `blob()` always fills with the bot's
 * base colour (`b.color`) and, for the black bot in dark or night, adds the
 * `.outl` stroke (#3A3836, width 2) to the body path only.
 */
function useBody(bot: BlobBot) {
  const t = useBotTheme(bot);
  return { fill: t.bot, outline: t.blobOutline };
}

function Body({ bot, fill, outline }: { bot: BlobBot; fill: string; outline: string | null }) {
  return (
    <G transform={`rotate(${bot.tilt} 50 50)`}>
      <Path
        d={SHAPES[bot.shape]}
        fill={fill}
        stroke={outline ?? undefined}
        strokeWidth={outline ? OUTLINE_WIDTH : undefined}
      />
    </G>
  );
}

/* ---------------- still ---------------- */

const NOOP_HANDLE: BlobHandle = {
  arrive() {},
  squash() {},
  leap() {},
  droop() {},
  hop() {},
};

const StillBlob = forwardRef<BlobHandle, Omit<BlobProps, "live" | "still">>(function StillBlob(
  { bot, size, look },
  ref,
) {
  useImperativeHandle(ref, () => NOOP_HANDLE, []);
  const { fill, outline } = useBody(bot);
  const ex = look?.x ?? 0;
  const ey = look?.y ?? 0;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 100 100" style={styles.overflow}>
        <Body bot={bot} fill={fill} outline={outline} />
        <G transform={`translate(${ex} ${ey})`}>
          <G transform={`rotate(${EYE_GROUP_ROTATION} ${EYE_GROUP_ORIGIN.x} ${EYE_GROUP_ORIGIN.y})`}>
            {EYES.map((e) => (
              <Rect key={e.x} x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} fill={EYE_FILL} />
            ))}
          </G>
        </G>
      </Svg>
    </View>
  );
});

/* ---------------- live ---------------- */

interface Motion {
  ty: SharedValue<number>;
  sx: SharedValue<number>;
  sy: SharedValue<number>;
  opacity: SharedValue<number>;
}

function play(m: Motion, name: ReactionName, reduced: boolean) {
  const reaction = REACTIONS[name];
  if (reduced) {
    // Reduced motion: fades only. Arrive fades in; the others don't move.
    m.ty.value = 0;
    m.sx.value = 1;
    m.sy.value = 1;
    m.opacity.value =
      name === "arrive"
        ? withSequence(
            withTiming(0, { duration: 0 }),
            withTiming(1, {
              duration: REDUCED_FADE_MS,
              easing: EASINGS.ease,
              reduceMotion: ReduceMotion.Never,
            }),
          )
        : 1;
    return;
  }
  const easing = EASINGS[reaction.curve];
  const run = (sv: SharedValue<number>, key: "ty" | "sx" | "sy" | "opacity") => {
    const steps = reactionSegments(reaction, key).map((s) =>
      withTiming(s.to, { duration: s.durationMs, easing, reduceMotion: ReduceMotion.Never }),
    );
    sv.value = steps.length === 1 ? steps[0]! : withSequence(...steps);
  };
  run(m.ty, "ty");
  run(m.sx, "sx");
  run(m.sy, "sy");
  run(m.opacity, "opacity");
}

const LiveBlob = forwardRef<BlobHandle, Omit<BlobProps, "live" | "still">>(function LiveBlob(
  { bot, size, look },
  ref,
) {
  const { fill, outline } = useBody(bot);
  const reduced = useReducedMotion();
  const { eyeX, eyeY, eyeScaleY } = useBlobLife(true, look);
  const ty = useSharedValue(0);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const opacity = useSharedValue(1);

  useImperativeHandle(
    ref,
    () => {
      const m = { ty, sx, sy, opacity };
      return {
        arrive: () => play(m, "arrive", reduced),
        squash: () => play(m, "squash", reduced),
        leap: () => play(m, "leap", reduced),
        droop: () => play(m, "droop", reduced),
        hop: () => play(m, "hop", reduced),
      };
    },
    [ty, sx, sy, opacity, reduced],
  );

  const unit = size / 100;

  const bodyStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, opacity.value)),
    transform: [{ translateY: ty.value }, { scaleX: sx.value }, { scaleY: sy.value }],
  }));
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: eyeX.value * unit }, { translateY: eyeY.value * unit }],
  }));
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: eyeScaleY.value }] }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          width: size,
          height: size,
          transformOrigin: `${REACTION_ORIGIN.x * 100}% ${REACTION_ORIGIN.y * 100}%`,
        },
        bodyStyle,
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100" style={[StyleSheet.absoluteFill, styles.overflow]}>
        <Body bot={bot} fill={fill} outline={outline} />
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
                  left: e.x * unit,
                  top: e.y * unit,
                  width: e.width * unit,
                  height: e.height * unit,
                  borderRadius: e.rx * unit,
                  backgroundColor: EYE_FILL,
                },
                eyeStyle,
              ]}
            />
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
});

export const Blob = forwardRef<BlobHandle, BlobProps>(function Blob({ live, still, ...rest }, ref) {
  const isLive = live === true && still !== true;
  return isLive ? <LiveBlob ref={ref} {...rest} /> : <StillBlob ref={ref} {...rest} />;
});

const styles = StyleSheet.create({
  overflow: { overflow: "visible" },
});
