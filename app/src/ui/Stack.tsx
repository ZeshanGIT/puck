/**
 * The A8 stack container: the prototype's `.stacked`, `.stackhead`, `.qrow`, `.qb`, `.qu`, `.qa`,
 * `.sumb`, `.qlabel`, `.stack`, `.acard`, `.peek` and `wireStack()`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `Design implementation guide.md`, row `Stack`.
 *
 * - `fill` background. A top row of small bot blobs, one per card (the current one 32 dp, the
 *   others 22 dp at half opacity), each with a red dot while urgent and unanswered or a status
 *   dot once answered, and the summary icon at the end; under it the caption.
 * - The front card (radius 32, a soft shadow) with up to two peeks behind it, tinted in the NEXT
 *   cards' bot colours: at -14 dp scaled .95 and at -27 dp scaled .9 and 85% opaque, both from
 *   the top edge. The summary has no colour, so it never peeks (`peekSlots`).
 * - Drag the card sideways to cycle (`CardLayer`): a drag starts after 10 dp when it is mostly
 *   horizontal, the card follows the finger tilting `dx / 28` degrees, and past 90 dp it flies to
 *   +-470 dp rotated +-14 degrees. Then the next card comes in: from the back (dragged left, or a
 *   blob tapped) or from the side (dragged right). Nothing is answered or dismissed by a drag.
 *   Reduced motion: no tilt; the card fades out and the next one fades in.
 * - Tap fallbacks: every blob and the summary icon is a labelled button that jumps to its card,
 *   and the caption is an adjustable control (screen reader increment / decrement and the named
 *   "Next card" / "Previous card" actions) that does what the drag does.
 * - The cards are `items[i].render()`; the last slot (`extra`, the summary) is the card after the
 *   last item. `index` runs 0 to `items.length` (`items.length` is the summary).
 *
 * The container decides nothing about answers: the screen (`AStack`) owns the index and what is
 * in the cards. Colours come from the theme hooks only.
 */
import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import {
  AccessibilityInfo,
  type AccessibilityActionEvent,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "./Text";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  type EntryExitAnimationFunction,
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { peekSlots, stepSlot } from "../stackOrder";
import { Glyph } from "./AlertFrame";
import { Blob } from "./Blob";
import { CURVES, type BlobBot } from "./blobShapes";
import { PALETTE } from "./botTheme";
import { useTheme } from "./theme";
import { fontFamily, radii } from "./tokens";

/** Where an answer has got to. `waiting` is not answered yet; the rest are the A7 receipt's states. */
export type StackStatus = "waiting" | "sending" | "sent" | "delivered" | "failed" | "queued";

export interface StackItem {
  key: string;
  /** Colours the blob in the top row and this card's peek. */
  bot: BlobBot;
  /** Spoken name of the blob button, usually the bot's name. */
  label: string;
  /** Urgent and unanswered: the red dot on the blob. */
  urgent?: boolean;
  /** Anything but `waiting` puts a status dot on the blob. */
  status?: StackStatus;
  /** Said after the name by the blob's button, such as "no longer needed". */
  note?: string;
  /** The card's content: it fills the card (a wash, the middle, the bottom). */
  render: () => ReactNode;
}

export interface StackExtra {
  key: string;
  /** Spoken name of the icon button at the end of the row ("Summary"). */
  label: string;
  render: () => ReactNode;
}

export interface StackProps {
  items: readonly StackItem[];
  /** The last slot after the items (the summary), selected by the icon at the end of the top row. */
  extra?: StackExtra;
  /** The front card: 0 to `items.length - 1` for an item, `items.length` for `extra`. */
  index: number;
  onIndexChange: (index: number) => void;
  /** `.qlabel`, "1 of 3 answered · swipe to switch". */
  caption: string;
}

/* ------------------------------------------------------------------ numbers */

/** `Math.abs(mx)>10` in `wireStack()`. */
const DRAG_START = 10;
/** `Math.abs(dx)>90`. */
const DRAG_COMMIT = 90;
/** `translateX(dx<0?-470:470px) rotate(dx<0?-14:14deg)`. */
const FLY_PX = 470;
const FLY_DEG = 14;
/** `setTimeout(()=>cycle(dir),170)`: the card is on its way out for this long before the next comes. */
const FLY_MS = 170;
/** `rotate(${dx/28}deg)` while dragging. */
const TILT_DIVISOR = 28;
/** `transition: transform .45s var(--spring)`: the card going home after a short drag. */
const HOME_MS = 450;
/** `fromback` and `fromside` run .42 s. */
const ENTER_MS = 420;
const REDUCED_FADE_MS = 150;
const PEEK_NEAR = { y: -14, scale: 0.95, opacity: 1 } as const;
const PEEK_FAR = { y: -27, scale: 0.9, opacity: 0.85 } as const;
const PEEK_WASH_HEIGHT = 34;
const MAX_FONT_SCALE = 1.3;
const SPRING_EASING = Easing.bezier(...CURVES.spring);

const LIST_ICON = "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01";

type EnterKind = "none" | "fromback" | "fromside";

/** `@keyframes fromback{from{transform:translateY(-14px) scale(.95); transform-origin:50% 0; opacity:.6}}` */
const fromBack: EntryExitAnimationFunction = () => {
  "worklet";
  const config = { duration: ENTER_MS, easing: SPRING_EASING };
  return {
    initialValues: { opacity: 0.6, transform: [{ translateY: -14 }, { scale: 0.95 }] },
    animations: {
      opacity: withTiming(1, config),
      transform: [{ translateY: withTiming(0, config) }, { scale: withTiming(1, config) }],
    },
  };
};

/** `@keyframes fromside{from{transform:translateX(-90px) rotate(-4deg); opacity:.3}}` */
const fromSide: EntryExitAnimationFunction = () => {
  "worklet";
  const config = { duration: ENTER_MS, easing: SPRING_EASING };
  return {
    initialValues: { opacity: 0.3, transform: [{ translateX: -90 }, { rotate: "-4deg" }] },
    animations: {
      opacity: withTiming(1, config),
      transform: [{ translateX: withTiming(0, config) }, { rotate: withTiming("0deg", config) }],
    },
  };
};

/** The words for a status dot, for the blob button's spoken label. */
export function statusWord(status: StackStatus | undefined): string | null {
  switch (status) {
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
      return "couldn't send yet";
    case "queued":
      return "waiting for network";
    default:
      return null;
  }
}

/* -------------------------------------------------------------------- stack */

export function Stack({ items, extra, index, onIndexChange, caption }: StackProps) {
  const t = useTheme().tokens;
  const reduced = useReducedMotion();
  const slots = items.length + (extra ? 1 : 0);
  const slot = Math.min(Math.max(index, 0), Math.max(slots - 1, 0));
  const front = slot < items.length ? items[slot] : extra;

  // How the next front card comes in. The first card just appears; a drag sets it before moving.
  const kindRef = useRef<EnterKind>("fromback");
  const first = useRef(true);
  const kind: EnterKind = first.current ? "none" : kindRef.current;
  useEffect(() => {
    first.current = false;
    kindRef.current = "fromback";
  }, [slot]);

  // Say which card came forward (a drag or a tap changes what is on screen, not just a focus).
  const announced = useRef(slot);
  useEffect(() => {
    if (announced.current === slot) return;
    announced.current = slot;
    AccessibilityInfo.announceForAccessibility(`${front?.label ?? ""}, ${slot + 1} of ${slots}`);
  }, [slot, slots, front]);

  const move = useCallback(
    (direction: 1 | -1): boolean => {
      const next = stepSlot(slot, direction, slots);
      if (next === slot) return false;
      kindRef.current = direction > 0 ? "fromback" : "fromside";
      onIndexChange(next);
      return true;
    },
    [slot, slots, onIndexChange],
  );

  const jump = useCallback(
    (target: number) => {
      if (target === slot) return;
      kindRef.current = "fromback";
      onIndexChange(target);
    },
    [slot, onIndexChange],
  );

  const onCaptionAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === "increment" || name === "next") move(1);
    else if (name === "decrement" || name === "previous") move(-1);
  };

  const top = (StatusBar.currentHeight ?? 24) + 8;
  const peeks = peekSlots(slot, items.length, extra !== undefined);
  const enteringAnimation =
    kind === "none" ? undefined : reduced ? FadeIn.duration(REDUCED_FADE_MS) : kind === "fromside" ? fromSide : fromBack;

  return (
    <View style={[styles.screen, { backgroundColor: t.fill }]}>
      <View style={[styles.head, { paddingTop: top + 2 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.rowScroll}
          contentContainerStyle={styles.row}
        >
          {items.map((item, i) => (
            <HeadButton key={item.key} selected={i === slot} onPress={() => jump(i)} label={headLabel(item)}>
              <Blob bot={item.bot} size={i === slot ? 32 : 22} />
              {item.status && item.status !== "waiting" ? (
                <StatusDot status={item.status} />
              ) : item.urgent ? (
                <UrgentDot />
              ) : null}
            </HeadButton>
          ))}
          {extra ? (
            <HeadButton
              selected={slot === items.length}
              onPress={() => jump(items.length)}
              label={extra.label}
              bare
            >
              <View style={[styles.sumb, { backgroundColor: t.card, borderColor: t.line }]}>
                <Glyph d={LIST_ICON} size={15} colour={t.ink} width={2.4} />
              </View>
            </HeadButton>
          ) : null}
        </ScrollView>
        <Text
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={caption}
          accessibilityValue={{ text: `Card ${slot + 1} of ${slots}` }}
          accessibilityActions={[
            { name: "increment", label: "Next card" },
            { name: "decrement", label: "Previous card" },
          ]}
          onAccessibilityAction={onCaptionAction}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.caption, { color: t.ink3 }]}
        >
          {caption}
        </Text>
      </View>

      <View style={styles.stack}>
        {[...peeks].reverse().map((peekSlot) => {
          const item = items[peekSlot];
          if (!item) return null;
          const near = peeks[0] === peekSlot;
          return <Peek key={item.key} bot={item.bot} look={near ? PEEK_NEAR : PEEK_FAR} />;
        })}
        {front ? (
          <CardLayer
            key={front.key}
            entering={enteringAnimation}
            origin={kind === "fromside" ? "50% 50%" : "50% 0%"}
            enabled={slots > 1}
            onStep={move}
          >
            {front.render()}
          </CardLayer>
        ) : null}
      </View>
    </View>
  );
}

function headLabel(item: StackItem): string {
  const parts = [item.label];
  if (item.urgent && (!item.status || item.status === "waiting")) parts.push("urgent");
  const word = statusWord(item.status);
  if (word) parts.push(word);
  if (item.note) parts.push(item.note);
  return parts.join(", ");
}

/* --------------------------------------------------------------- card layer */

/**
 * One front card with its drag. It is keyed by the card, so a change of card mounts a new one:
 * the drag values start at rest and the layout animation (`entering`) brings it in.
 */
function CardLayer({
  children,
  entering,
  origin,
  enabled,
  onStep,
}: {
  children: ReactNode;
  entering: EntryExitAnimationFunction | ReturnType<typeof FadeIn.duration> | undefined;
  origin: string;
  enabled: boolean;
  /** Moves to the next (1) or previous (-1) card; false when there was nowhere to go. */
  onStep: (direction: 1 | -1) => boolean;
}) {
  const t = useTheme().tokens;
  const reduced = useReducedMotion();
  const dx = useSharedValue(0);
  const rotation = useSharedValue(0);
  const fade = useSharedValue(1);

  const home = useCallback(() => {
    cancelAnimation(dx);
    cancelAnimation(rotation);
    cancelAnimation(fade);
    const config = { duration: HOME_MS, easing: SPRING_EASING };
    dx.value = withTiming(0, config);
    rotation.value = withTiming(0, config);
    fade.value = withTiming(1, { duration: REDUCED_FADE_MS });
  }, [dx, rotation, fade]);

  const step = useCallback(
    (direction: 1 | -1) => {
      // No card to go to (a stack of one): the card comes back.
      if (!onStep(direction)) home();
    },
    [onStep, home],
  );

  const pan = usePanGesture({
    enabled,
    // `Math.abs(mx)>10 && Math.abs(mx)>Math.abs(my)`; more than 10 dp of vertical first is a scroll.
    // Nothing gates the drag on a distance at activation (the translation can still read near zero then).
    activeOffsetX: [-DRAG_START, DRAG_START],
    failOffsetY: [-DRAG_START, DRAG_START],
    onUpdate: (e) => {
      "worklet";
      dx.value = e.translationX;
      rotation.value = reduced ? 0 : e.translationX / TILT_DIVISOR;
    },
    onDeactivate: (e) => {
      "worklet";
      const moved = dx.value;
      if (e.canceled || Math.abs(moved) <= DRAG_COMMIT) {
        const config = { duration: HOME_MS, easing: SPRING_EASING };
        dx.value = withTiming(0, config);
        rotation.value = withTiming(0, config);
        return;
      }
      const direction: 1 | -1 = moved < 0 ? 1 : -1;
      const sign = moved < 0 ? -1 : 1;
      if (reduced) {
        fade.value = withTiming(0, { duration: REDUCED_FADE_MS }, (finished) => {
          "worklet";
          if (finished) scheduleOnRN(step, direction);
        });
        return;
      }
      rotation.value = withTiming(sign * FLY_DEG, { duration: FLY_MS });
      dx.value = withTiming(
        sign * FLY_PX,
        { duration: FLY_MS, easing: Easing.out(Easing.quad) },
        (finished) => {
          "worklet";
          if (finished) scheduleOnRN(step, direction);
        },
      );
    },
  });

  const moved = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: dx.value }, { rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View entering={entering} style={[StyleSheet.absoluteFill, { transformOrigin: origin }]}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: t.card,
              borderColor: t.line,
              boxShadow: [{ offsetX: 0, offsetY: 14, blurRadius: 34, spreadDistance: 0, color: "rgba(30, 27, 25, 0.09)" }],
            },
            moved,
          ]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/* -------------------------------------------------------------------- peeks */

/**
 * `.peek`: the card behind, its top 34 dp washed with the next bot's colour (`rgba(rgb, .22)`,
 * black `rgba(0,0,0,.10)`) fading into the card colour.
 */
function Peek({ bot, look }: { bot: BlobBot; look: { y: number; scale: number; opacity: number } }) {
  const t = useTheme().tokens;
  const gradient = useId();
  const entry = PALETTE.find((p) => p.name === bot.colour);
  const rgb = entry ? `rgb(${entry.rgb[0]}, ${entry.rgb[1]}, ${entry.rgb[2]})` : "rgb(0, 0, 0)";
  const alpha = bot.colour === "black" ? 0.1 : 0.22;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.peek,
        {
          backgroundColor: t.card,
          borderColor: t.line,
          opacity: look.opacity,
          transform: [{ translateY: look.y }, { scale: look.scale }],
        },
      ]}
    >
      <Svg width="100%" height={PEEK_WASH_HEIGHT} accessible={false}>
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={rgb} stopOpacity={alpha} />
            <Stop offset="1" stopColor={rgb} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={PEEK_WASH_HEIGHT} fill={`url(#${gradient})`} />
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------- top row parts */

/** `.qb`: a blob (or the summary icon) as a button; 50% opacity until it is the front card (`.2s`). */
function HeadButton({
  children,
  selected,
  onPress,
  label,
  bare = false,
}: {
  children: ReactNode;
  selected: boolean;
  onPress: () => void;
  label: string;
  /** No fixed box: the child brings its own size (the summary icon). */
  bare?: boolean;
}) {
  const opacity = useSharedValue(selected ? 1 : 0.5);
  useEffect(() => {
    opacity.value = withTiming(selected ? 1 : 0.5, { duration: 200 });
  }, [selected, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      onPress={onPress}
    >
      <Animated.View style={[bare ? null : styles.qb, style]}>{children}</Animated.View>
    </Pressable>
  );
}

/** `.qu`: 9 dp red dot, top right, with a 2 dp ring in the `fill` colour. */
function UrgentDot() {
  const t = useTheme().tokens;
  return (
    <View
      accessible={false}
      style={[
        styles.qu,
        {
          backgroundColor: t.danger,
          boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 2, color: t.fill }],
        },
      ]}
    />
  );
}

/**
 * `.qa`: 13 dp status dot, bottom right, 2 dp ring in `fill`. Delivered is green, sent ink3,
 * waiting for network amber; sending is a ring turning in the card colour.
 */
function StatusDot({ status }: { status: Exclude<StackStatus, "waiting"> }) {
  const t = useTheme().tokens;
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  const sending = status === "sending";
  useEffect(() => {
    if (!sending || reduced) {
      cancelAnimation(turn);
      turn.value = 0;
      return;
    }
    turn.value = 0;
    turn.value = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [sending, reduced, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const ring = { offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 2, color: t.fill };
  if (sending) {
    return (
      <Animated.View
        accessible={false}
        style={[
          styles.qa,
          { backgroundColor: t.card, borderWidth: 2, borderColor: t.edge, borderTopColor: t.ink2, boxShadow: [ring] },
          spin,
        ]}
      />
    );
  }
  const colour = status === "delivered" ? t.ok : status === "sent" ? t.ink3 : t.warn;
  return <View accessible={false} style={[styles.qa, { backgroundColor: colour, boxShadow: [ring] }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  /** `.stackhead{padding:2px 20px 0; text-align:center}` */
  head: { paddingHorizontal: 20, alignItems: "stretch" },
  rowScroll: { flexGrow: 0 },
  /** `.qrow{display:flex; justify-content:center; align-items:center; gap:12px; height:42px}` */
  row: { flexGrow: 1, height: 42, justifyContent: "center", alignItems: "center", gap: 12 },
  qb: { alignItems: "center", justifyContent: "center" },
  qu: { position: "absolute", top: -2, right: -4, width: 9, height: 9, borderRadius: 4.5 },
  qa: { position: "absolute", bottom: -3, right: -5, width: 13, height: 13, borderRadius: 6.5 },
  sumb: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  caption: {
    textAlign: "center",
    marginTop: 2,
    fontFamily: fontFamily.extraBold,
    fontSize: 13,
    fontWeight: "800",
  },
  /** `.stack{flex:1; min-height:0; position:relative; margin:34px 12px 6px}`, plus the room the gesture bar takes. */
  stack: { flex: 1, minHeight: 0, marginTop: 34, marginHorizontal: 12, marginBottom: 6 + 16 },
  card: {
    flex: 1,
    borderRadius: radii.stackCard,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  peek: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.stackCard,
    borderWidth: 1.5,
    overflow: "hidden",
    transformOrigin: "50% 0%",
  },
});
