/**
 * One alert as a stack card: the prototype's `alertBody(a, false, true)` (the stacked form) inside
 * `.acard` (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` A8.
 *
 * Top to bottom, on the card's bot-coloured wash: the blob (104 dp, 84 once answered, with the
 * urgent rings while an urgent alert waits), the who line, the expiry pill, the question at the
 * stack size (25 / 800), the message, Show more with the details and the link; then the pinned
 * bottom with the controls for the alert's kind:
 * - single choice: tap-twice options (`OptionButton`), one tap for an FYI;
 * - multi: checkboxes (`CheckOption`), Select all, and Send N (tap twice);
 * - swipe: the `SwipeTrack`, with Puck's Snooze on the left of a one-option alarm;
 * and Reply and Snooze under them.
 * Once an answer is in (`status` is not `waiting`) the controls give way to the prototype's
 * answered block: "You answered", every option with the picks highlighted, the reply and its
 * attachments, and a status line that follows `status` ("Sending…", "Sent", "Delivered to <bot>").
 *
 * The card sends nothing: `onAnswer(optionIds, customReply?)` goes up to the screen, which sets
 * `status` and `answer`. Reply and Snooze are the screen's too (`onReply`, `onSnooze`).
 *
 * The middle's pieces (wash, rings, expiry pill, who line, details, link) are drawn here rather
 * than by `AlertFrame` because `AlertFrame` is the full-screen frame; they follow its numbers.
 */
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  type LayoutChangeEvent,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, useLines } from "./Text";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
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
import type { PendingAlert } from "../ChoiceScreen";
import { emptyChoice, type ChoiceState, tapOption, toggleAll } from "../choice";
import { Spinner } from "../onboarding/parts";
import { receiptLine } from "../receiptCopy";
import { ageLabel, AlertSecondaryRow, Glyph, ICON, useExpiry, type ExpiryView } from "./AlertFrame";
import { Blob, type BlobHandle } from "./Blob";
import { ringBox, ringGeometry, type RingGeometry } from "./blobCentre";
import type { BlobBot, Offset } from "./blobShapes";
import { botLook } from "./botLook";
import { Btn } from "./Btn";
import { CheckOption } from "./CheckOption";
import { OptionButton } from "./OptionButton";
import { RichText } from "./RichText";
import type { StackStatus } from "./Stack";
import { SwipeTrack, type SwipeSide, type SwipeSideSpec, type SwipeTrackHandle } from "./SwipeTrack";
import { useBotTheme, useOnWash, useTheme } from "./theme";
import { fontFamily, radii } from "./tokens";
import { haptics, TapTwiceGroup } from "./useTapTwice";

/** What he answered, as the answered block shows it. */
export interface StackAnswer {
  optionIds: string[];
  customReply?: string;
  /** Spoken-style names, such as "a photo" or "report.pdf" (shown as "+ a photo, report.pdf"). */
  attachments?: string[];
  status: Exclude<StackStatus, "waiting">;
}

export interface StackCardProps {
  alert: PendingAlert;
  /** `waiting` draws the controls; anything else draws the answered block (and needs `answer`). */
  status?: StackStatus;
  answer?: Pick<StackAnswer, "optionIds" | "customReply" | "attachments">;
  /** He answered. The screen sets `status` to `sending` (and `answer`) in response. */
  onAnswer: (optionIds: string[], customReply?: string) => void;
  /** Opens the reply sheet (A5). Left out, Reply says it is coming later. */
  onReply?: () => void;
  /** Opens the snooze choices (A11). Left out, Snooze says it is coming later. */
  onSnooze?: () => void;
  /** A short message for the screen to show as a Toast. */
  notify?: (message: string) => void;
  /**
   * The alert is no longer needed (the bot cancelled it, it expired, or it was answered elsewhere):
   * the card is greyed, takes no touches, and its bottom says what happened instead of the controls.
   */
  gone?: StackGone;
}

/** The words of a gone card (`goneCopy` in `receiptCopy.ts`). */
export interface StackGone {
  title: string;
  sub: string | null;
}

const MAX_FONT_SCALE = 1.3;
/** `S.armedAt` guard in `ACT.opt`: a touch within this long of the card opening is ignored. */
const STALE_TOUCH_MS = 350;
/** `size = stacked ? (a.answer ? 84 : 104)`. */
const BLOB_SIZE = 104;
const BLOB_SIZE_ANSWERED = 84;
const ARM_LOOK: Offset = { x: -1, y: 4 };
const LOOK_Y = 3;
const LOOK_X = 4;
const UNDO = "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11";
const WARN =
  "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";
const ICON_PATHS: Record<string, string> = {
  undo: UNDO,
  warn: WARN,
  snooze: ICON.snooze,
  check: ICON.check,
  clock: ICON.clock,
  reply: ICON.reply,
  alarm: ICON.alarm,
  out: ICON.out,
};

/** `S.answeredOnce`: the "Tap twice to answer" hint goes away after the first answer. */
let answeredOnce = false;

export function StackCard(props: StackCardProps) {
  const { alert, status = "waiting", answer, gone } = props;
  const bot = useMemo(() => botLook({ botId: alert.botId, botName: alert.botName }), [alert.botId, alert.botName]);
  const bt = useBotTheme(bot);
  const blob = useRef<BlobHandle>(null);
  const [look, setLook] = useState<Offset | null>(null);
  const answered = status !== "waiting";
  const urgent = alert.priority === "urgent" && !gone;

  const expiry = useExpiry(alert.expiresAt, alert.createdAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // A leap for the alert that has just been answered (the prototype's `S.justAnswered`).
  const wasAnswered = useRef(answered);
  useEffect(() => {
    if (answered && !wasAnswered.current) blob.current?.leap();
    wasAnswered.current = answered;
  }, [answered]);

  return (
    <View style={styles.fill}>
      <StackWash colour={bt.botWash} />
      <View
        style={[styles.fill, gone ? styles.dim : null]}
        pointerEvents={gone ? "none" : "auto"}
        importantForAccessibility={gone ? "no-hide-descendants" : "auto"}
      >
        <MiddleColumn
          alert={alert}
          bot={bot}
          status={status}
          urgent={urgent}
          now={now}
          expiry={gone ? null : expiry}
          blobRef={blob}
          look={look}
          notify={props.notify}
        />
      </View>
      <View style={styles.abottom}>
        {gone ? (
          <GoneBlock gone={gone} />
        ) : answered ? (
          <AnsweredBlock alert={alert} bot={bot} status={status} answer={answer} />
        ) : (
          <Controls {...props} bot={bot} blob={blob} onLook={setLook} expired={expiry?.expired === true} />
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- middle */

function MiddleColumn({
  alert,
  bot,
  status,
  urgent,
  now,
  expiry,
  blobRef,
  look,
  notify,
}: {
  alert: PendingAlert;
  bot: BlobBot;
  status: StackStatus;
  urgent: boolean;
  now: number;
  expiry: ExpiryView | null;
  blobRef: React.RefObject<BlobHandle | null>;
  look: Offset | null;
  notify?: (message: string) => void;
}) {
  const { tokens: t, dark, night } = useTheme();
  const bt = useBotTheme(bot);
  const onWash = useOnWash(bt.botWash, t.bg);
  const whoLines = useLines(1);
  const reduced = useReducedMotion();
  const answered = status !== "waiting";
  const [expanded, setExpanded] = useState(false);
  const dotRing = night || (dark && bot.colour === "black") ? "#5A5754" : null;

  async function openLink() {
    const url = alert.link?.url;
    try {
      if (!url || !/^https?:\/\//iu.test(url)) throw new Error("not a web link");
      await Linking.openURL(url);
    } catch {
      notify?.("Couldn't open the link");
    }
  }

  return (
    <ScrollView
      style={styles.amid}
      contentContainerStyle={styles.amidContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.ablob, { width: answered ? BLOB_SIZE_ANSWERED : BLOB_SIZE, height: answered ? BLOB_SIZE_ANSWERED : BLOB_SIZE }]}>
        {urgent && !answered ? <UrgentRings colour={bt.mark} geometry={ringGeometry(bot, BLOB_SIZE)} /> : null}
        <Blob
          ref={blobRef}
          bot={bot}
          size={answered ? BLOB_SIZE_ANSWERED : BLOB_SIZE}
          live={!answered}
          look={look}
        />
      </View>

      <View style={styles.who} accessible accessibilityLabel={`${bot.name}, ${ageLabel(alert.createdAt, now)}`}>
        <View
          style={[
            styles.dot,
            { backgroundColor: bt.mark },
            dotRing ? styles.dotRing : null,
            dotRing ? { borderColor: dotRing } : null,
          ]}
        />
        <Text numberOfLines={whoLines} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.whoName, { color: t.ink }]}>
          {bot.name}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.whoAge, { color: onWash.ink3 }]}>
          · {ageLabel(alert.createdAt, now)}
        </Text>
      </View>

      {expiry && !answered ? <ExpiryPill expiry={expiry} /> : null}

      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.question, { color: t.ink }]}
      >
        {alert.question}
      </Text>

      {alert.message && !answered ? (
        <View style={styles.msg}>
          <RichText
            text={alert.message}
            style={{
              fontFamily: fontFamily.semiBold,
              fontSize: 16,
              fontWeight: "600",
              lineHeight: 16 * 1.45,
              textAlign: "center",
              color: onWash.ink2,
            }}
          />
        </View>
      ) : null}

      {alert.details && !answered ? (
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
              style={[styles.moreText, { color: t.ink, textDecorationColor: t.edge }]}
            >
              {expanded ? "Show less" : "Show more"}
            </Text>
          </Pressable>
          {expanded ? (
            <Animated.View entering={reduced ? FadeIn.duration(200) : FadeInDown.duration(200)} style={[styles.details, { backgroundColor: t.fill }]}>
              <Text
                selectable
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.detailsText, { color: t.ink2 }]}
              >
                {alert.details}
              </Text>
            </Animated.View>
          ) : null}
        </>
      ) : null}

      {alert.link && !answered ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={alert.link.label}
          onPress={() => void openLink()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.linkPill, { backgroundColor: t.card, borderColor: t.line }]}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: t.ink2 }]}>
            {alert.link.label}
          </Text>
          <Glyph d={ICON.out} size={13} colour={t.ink2} width={2.4} />
        </Pressable>
      ) : null}

      <View style={styles.spacer} />
    </ScrollView>
  );
}

/* ----------------------------------------------------------------- controls */

type ControlsProps = StackCardProps & {
  bot: BlobBot;
  blob: React.RefObject<BlobHandle | null>;
  onLook: (look: Offset | null) => void;
  expired: boolean;
};

function Controls(props: ControlsProps) {
  const { alert } = props;
  if (alert.presentation === "swipe") return <SwipeControls {...props} />;
  if (alert.selectionMode === "multi") return <MultiControls {...props} />;
  return (
    <TapTwiceGroup>
      <SingleControls {...props} />
    </TapTwiceGroup>
  );
}

/** A guard that re-opens once the answer is back to `waiting` (a failed send), and shuts on the first call. */
function useSendOnce(status: StackStatus) {
  const busy = useRef(false);
  useEffect(() => {
    if (status === "waiting") busy.current = false;
  }, [status]);
  return useCallback((send: () => void) => {
    if (busy.current) return;
    busy.current = true;
    send();
  }, []);
}

function SingleControls({ alert, bot, blob, onLook, expired, status, onAnswer, onReply, onSnooze, notify }: ControlsProps) {
  const armedIds = useRef(new Set<string>());
  const [ready, setReady] = useState(false);
  const once = useSendOnce(status ?? "waiting");
  useEffect(() => {
    const id = setTimeout(() => setReady(true), STALE_TOUCH_MS);
    return () => clearTimeout(id);
  }, []);

  const options = alert.options;
  const fyi = options.length === 1;

  const onArmedChange = useCallback(
    (id: string, armed: boolean) => {
      if (armed) {
        armedIds.current.add(id);
        blob.current?.squash();
      } else {
        armedIds.current.delete(id);
      }
      onLook(armedIds.current.size > 0 ? ARM_LOOK : null);
    },
    [blob, onLook],
  );

  function send(optionId: string) {
    once(() => {
      answeredOnce = true;
      armedIds.current.clear();
      onLook(null);
      onAnswer([optionId]);
    });
  }

  return (
    <>
      {answeredOnce || fyi ? null : <Hint>Tap twice to answer</Hint>}
      <View style={styles.opts}>
        {options.map((option) => (
          <OptionButton
            key={option.id}
            label={option.label}
            desc={option.desc}
            tone={option.tone}
            rec={option.rec}
            bot={bot}
            armedHint={fyi ? undefined : "Tap again"}
            immediate={fyi}
            disabled={expired}
            inert={!ready}
            onConfirm={() => send(option.id)}
            onArmedChange={(armed) => onArmedChange(option.id, armed)}
          />
        ))}
      </View>
      <SecondaryRow onReply={onReply} onSnooze={onSnooze} notify={notify} />
    </>
  );
}

function MultiControls({ alert, bot, blob, expired, status, onAnswer, onReply, onSnooze, notify }: ControlsProps) {
  const [choice, setChoice] = useState<ChoiceState>(emptyChoice);
  const once = useSendOnce(status ?? "waiting");
  const options = alert.options;
  const selectedIds = choice.selectedIds;
  const count = options.filter((o) => selectedIds.includes(o.id)).length;

  // Say "N selected" when the count changes (not on first render).
  const previousCount = useRef(count);
  useEffect(() => {
    if (previousCount.current === count) return;
    previousCount.current = count;
    AccessibilityInfo.announceForAccessibility(`${count} selected`);
  }, [count]);

  function toggle(optionId: string) {
    setChoice((state) => tapOption(state, "multi", optionId).state);
    blob.current?.squash();
  }

  function selectAll() {
    setChoice((state) =>
      toggleAll(
        state,
        options.map((o) => o.id),
      ),
    );
    blob.current?.squash();
  }

  function send() {
    // In the order of the options, whatever order the checks were made in.
    const chosen = options.filter((o) => selectedIds.includes(o.id));
    if (chosen.length === 0) return;
    once(() => onAnswer(chosen.map((o) => o.id)));
  }

  return (
    <>
      <SelectAll disabled={expired} allSelected={count === options.length} onPress={selectAll} />
      <View style={styles.opts}>
        {options.map((option) => (
          <CheckOption
            key={option.id}
            label={option.label}
            desc={option.desc}
            tone={option.tone}
            rec={option.rec}
            bot={bot}
            checked={selectedIds.includes(option.id)}
            disabled={expired}
            onToggle={() => toggle(option.id)}
          />
        ))}
      </View>
      <View style={styles.send}>
        {/* A new key per count drops an armed Send when the selection changes (`updSend()`). */}
        <Btn
          key={count}
          label={count === 0 ? "Send" : `Send ${count}`}
          variant="bot"
          bot={bot}
          disabled={expired || count === 0}
          tapTwice={{ onConfirm: send, armedLabel: `Tap again to send ${count}` }}
        />
      </View>
      <SecondaryRow onReply={onReply} onSnooze={onSnooze} notify={notify} />
    </>
  );
}

function SwipeControls({ alert, bot, blob, onLook, expired, status, onAnswer, onReply, onSnooze, notify }: ControlsProps) {
  const track = useRef<SwipeTrackHandle>(null);
  const once = useSendOnce(status ?? "waiting");
  const options = alert.options;
  const oneOption = options.length === 1;
  const valid = options.length === 1 || options.length === 2;

  // `const L = oneOpt ? {id:"__snooze",label:"Snooze",icon:"snooze"} : a.options[0]; const R = oneOpt ? a.options[0] : a.options[1];`
  const first = options[0];
  const second = options[1];
  const leftSpec: SwipeSideSpec | null = oneOption
    ? { label: "Snooze", icon: ICON.snooze, tone: "snooze" }
    : first
      ? sideSpec(first)
      : null;
  const rightSpec: SwipeSideSpec | null = oneOption ? (first ? sideSpec(first) : null) : second ? sideSpec(second) : null;
  const leftOption = oneOption ? null : first;
  const rightOption = oneOption ? first : second;
  const comingLater = () => notify?.("Coming in a later step");

  function onCommit(side: SwipeSide) {
    const option = side === "left" ? leftOption : rightOption;
    if (!option) {
      // Puck's Snooze: not an answer. The knob comes home; the snooze flow takes over.
      (onSnooze ?? comingLater)();
      track.current?.reset();
      return;
    }
    once(() => {
      blob.current?.leap();
      onAnswer([option.id]);
    });
  }

  function onArm(side: SwipeSide | null) {
    const spec = side === "left" ? leftSpec : side === "right" ? rightSpec : null;
    if (spec) notify?.(`Tap again to choose ${spec.label}`);
  }

  if (!(valid && leftSpec && rightSpec)) return <Hint>This swipe needs one or two options.</Hint>;
  return (
    <>
      <Hint>{oneOption ? "Drag right when you're up" : "Drag toward your answer"}</Hint>
      <TrackGuard>
        <SwipeTrack
          ref={track}
          left={leftSpec}
          right={rightSpec}
          bot={bot}
          disabled={expired}
          onCommit={onCommit}
          onLookChange={(direction) => onLook(direction === null ? null : { x: direction * LOOK_X, y: LOOK_Y })}
          onArm={onArm}
        />
      </TrackGuard>
      <SecondaryRow onReply={onReply} onSnooze={oneOption ? undefined : (onSnooze ?? comingLater)} notify={notify} />
    </>
  );
}

/**
 * `if(e.target.closest(".track")) return;` in `wireStack()`: a sideways drag that starts on the
 * track never cycles the card. A pan that does nothing, set to start just after the knob's own
 * (8 dp) and before the card's (10 dp), takes such a drag away from the card's pan.
 */
function TrackGuard({ children }: { children: ReactNode }) {
  const guard = usePanGesture({ activeOffsetX: [-9, 9], failOffsetY: [-12, 12] });
  return (
    <GestureDetector gesture={guard}>
      <View>{children}</View>
    </GestureDetector>
  );
}

function sideSpec(option: PendingAlert["options"][number]): SwipeSideSpec {
  const icon = option.icon ? ICON_PATHS[option.icon] : undefined;
  return {
    label: option.label,
    ...(icon ? { icon } : {}),
    ...(option.tone === "destructive" ? { tone: "destructive" as const } : {}),
  };
}

/** `.acard .secrow{padding:10px 4px 10px}`: the shared row has 14 / 6 / 8, so it is pulled in to match. */
function SecondaryRow({
  onReply,
  onSnooze,
  notify,
}: {
  onReply?: () => void;
  onSnooze?: () => void;
  notify?: (message: string) => void;
}) {
  const comingLater = () => notify?.("Coming in a later step");
  return (
    <View style={styles.secWrap}>
      <AlertSecondaryRow onReply={onReply ?? comingLater} onSnooze={onSnooze ?? comingLater} />
    </View>
  );
}

/** `.hint` and `.swipehint`: 13 / 800 ink3, centered, 10 dp above the controls. */
function Hint({ children }: { children: string }) {
  const t = useTheme().tokens;
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: t.ink3 }]}>
      {children}
    </Text>
  );
}

/** `.selall`: 14 / 800 ink2, right aligned, `margin:-2px 2px 10px`. */
function SelectAll({
  disabled,
  allSelected,
  onPress,
}: {
  disabled: boolean;
  allSelected: boolean;
  onPress: () => void;
}) {
  const t = useTheme().tokens;
  return (
    <View style={styles.selall}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select all"
        accessibilityHint={allSelected ? "Clears every option" : "Checks every option"}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={{ top: 16, bottom: 16, left: 16, right: 8 }}
        onPress={onPress}
        style={disabled ? styles.selallDisabled : null}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.selallText, { color: t.ink2 }]}>
          Select all
        </Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ gone block */

/** What happened to a card that is no longer needed; `.gone b` and `.gone p` of the prototype, in the card. */
function GoneBlock({ gone }: { gone: StackGone }) {
  const t = useTheme().tokens;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={gone.sub ? `${gone.title}. ${gone.sub}` : gone.title}
      style={styles.goneBlock}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.goneTitle, { color: t.ink }]}>
        {gone.title}
      </Text>
      {gone.sub ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.goneSub, { color: t.ink2 }]}>
          {gone.sub}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------ answered block */

/** `.answered`: "You answered", the options with the picks marked, the reply, and the live status. */
function AnsweredBlock({
  alert,
  bot,
  status,
  answer,
}: {
  alert: PendingAlert;
  bot: BlobBot;
  status: StackStatus;
  answer?: StackCardProps["answer"];
}) {
  const { tokens: t, dark } = useTheme();
  const bt = useBotTheme(bot);
  const picked = answer?.optionIds ?? [];
  const files = answer?.attachments?.length ? `+ ${answer.attachments.join(", ")}` : null;
  const line = receiptLine(status === "waiting" ? "sending" : status, alert.botName);
  const colour = line.tone === "ok" ? t.ok : line.tone === "warn" ? t.warn : t.ink2;
  const tick = dark ? bt.botLight : bt.bot;

  return (
    <View style={styles.answered}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.answeredLabel, { color: t.ink3 }]}>
        You answered
      </Text>
      <View style={styles.ans}>
        {alert.options.map((option) => {
          const pick = picked.includes(option.id);
          return (
            <View
              key={option.id}
              accessible
              accessibilityLabel={pick ? `${option.label}, chosen` : option.label}
              style={[
                styles.ansRow,
                { backgroundColor: pick ? bt.botTint : t.fill },
                pick
                  ? { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 1.5, color: bt.mark, inset: true }] }
                  : null,
              ]}
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.ansText, { color: pick ? t.ink : t.ink2 }, styles.ansTextFlex]}
              >
                {option.label}
              </Text>
              {pick ? <Glyph d={ICON.check} size={18} colour={tick} width={3} /> : null}
            </View>
          );
        })}
      </View>
      {answer?.customReply ? (
        <View style={[styles.quote, { backgroundColor: t.fill, borderLeftColor: bt.mark }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.quoteText, { color: t.ink2 }]}>
            {`“${answer.customReply}”`}
          </Text>
        </View>
      ) : null}
      {files ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.files, { color: t.ink2 }]}>
          {files}
        </Text>
      ) : null}
      <View style={styles.status} accessible accessibilityLiveRegion="polite" accessibilityLabel={line.text}>
        {line.icon === "spinner" ? (
          <Spinner />
        ) : line.icon === "warn" ? (
          <Glyph d={WARN} size={18} colour={colour} width={2.6} />
        ) : (
          <Glyph d={ICON.check} size={18} colour={colour} width={2.6} />
        )}
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.statusText, { color: colour }, styles.statusFlex]}
        >
          {line.text}
        </Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------- wash, rings */

function parseRgba(colour: string): { rgb: string; alpha: number } {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(colour);
  if (!m) return { rgb: colour, alpha: 1 };
  return { rgb: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

/** `.acard .wash`: `radial-gradient(120% 52% at 50% 12%, botwash 0%, transparent 62%)`. */
function StackWash({ colour }: { colour: string }) {
  const id = useId();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);
  const { rgb, alpha } = parseRgba(colour);
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
    >
      {size ? (
        <Svg width={size.w} height={size.h} accessible={false}>
          <Defs>
            <RadialGradient
              id={id}
              gradientUnits="userSpaceOnUse"
              cx={0.5 * size.w}
              cy={0.12 * size.h}
              rx={1.2 * size.w}
              ry={0.52 * size.h}
            >
              <Stop offset={0} stopColor={rgb} stopOpacity={alpha} />
              <Stop offset={0.62} stopColor={rgb} stopOpacity={0} />
              <Stop offset={1} stopColor={rgb} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

const RING_MS = 1400;
const RING_EASE = Easing.bezier(0, 0, 0.58, 1); // CSS ease-out

/** `.ring`: `pulse 1.4s ease-out infinite`, scale .9 to 1.65 and opacity .45 to 0; `.r2` starts .7 s later. */
function Ring({ colour, delay, geometry }: { colour: string; delay: number; geometry: RingGeometry }) {
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
      accessible={false}
      importantForAccessibility="no-hide-descendants"
            style={[styles.ring, ringBox(geometry), { borderColor: colour }, style]}
    />
  );
}

/** Two rings, 0.7 s apart. Not drawn with reduced motion. */
function UrgentRings({ colour, geometry }: { colour: string; geometry: RingGeometry }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <>
      <Ring colour={colour} delay={0} geometry={geometry} />
      <Ring colour={colour} delay={RING_MS / 2} geometry={geometry} />
    </>
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /** `.dim`: opacity .35 and a little grey (A9). */
  dim: { opacity: 0.35, filter: [{ grayscale: 0.4 }] },
  goneBlock: { alignItems: "center", paddingTop: 16, paddingHorizontal: 4, paddingBottom: 4, marginBottom: 10 },
  goneTitle: { fontFamily: fontFamily.black, fontSize: 18, fontWeight: "900", textAlign: "center" },
  goneSub: { fontFamily: fontFamily.semiBold, fontSize: 15, fontWeight: "600", textAlign: "center", marginTop: 6 },
  /** `.acard .amid{padding:4px 22px 0}`; `.amid{flex:1; min-height:0}` */
  amid: { flex: 1, minHeight: 0 },
  amidContent: { flexGrow: 1, alignItems: "center", paddingTop: 4, paddingHorizontal: 22 },
  /** `.acard .ablob{margin:16px 0 12px}` */
  ablob: { marginTop: 16, marginBottom: 12, alignItems: "center", justifyContent: "center" },
  ring: { borderWidth: 3 },
  who: { flexDirection: "row", alignItems: "center", gap: 7, maxWidth: "100%" },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  dotRing: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, margin: -1.5 },
  whoName: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  whoAge: { fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700" },
  exp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
    minHeight: 28,
    paddingVertical: 3,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  expText: { fontFamily: fontFamily.extraBold, fontSize: 13, fontWeight: "800" },
  expTrack: { width: 40, height: 4, borderRadius: 2, overflow: "hidden" },
  expFill: { height: "100%" },
  /** `.acard .q{font-size:25px}` over `.q{line-height:1.14; letter-spacing:-.015em; margin-top:12px}` */
  question: {
    fontFamily: fontFamily.extraBold,
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 25 * 1.14,
    letterSpacing: 25 * -0.015,
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
  /** `.acard .abottom{padding:4px 14px 0}` */
  abottom: { paddingTop: 4, paddingHorizontal: 14 },
  opts: { gap: 12 },
  hint: {
    textAlign: "center",
    fontFamily: fontFamily.extraBold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 13 * 0.01,
    marginBottom: 10,
  },
  selall: { flexDirection: "row", justifyContent: "flex-end", marginTop: -2, marginHorizontal: 2, marginBottom: 10 },
  selallDisabled: { opacity: 0.32 },
  selallText: { fontFamily: fontFamily.extraBold, fontSize: 14, fontWeight: "800" },
  send: { marginTop: 14 },
  /** The shared row is `14 / 6 / 8`; `.acard .secrow` is `10 / 4 / 10`. */
  secWrap: { marginTop: -4, marginHorizontal: -2, marginBottom: 2 },
  /** `.answered{padding:16px 4px 4px; text-align:center; margin-bottom:10px}` */
  answered: {
    alignItems: "center",
    borderRadius: radii.card,
    paddingTop: 16,
    paddingHorizontal: 4,
    paddingBottom: 4,
    marginBottom: 10,
  },
  /** The prototype leaves `.answered .rl` unstyled; this is the receipt's `.rl` (`.receipt .rl`). */
  answeredLabel: {
    fontFamily: fontFamily.extraBold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 13 * 0.07,
    textTransform: "uppercase",
  },
  /** `.answered .ans{margin:10px 0 0}`, `.ans{display:flex; flex-direction:column; gap:8px}` */
  ans: { alignSelf: "stretch", marginTop: 10, gap: 8 },
  ansRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  ansText: { fontFamily: fontFamily.extraBold, fontSize: 15.5, fontWeight: "800" },
  ansTextFlex: { flexShrink: 1 },
  quote: {
    alignSelf: "stretch",
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderLeftWidth: 3,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  quoteText: { fontFamily: fontFamily.semiBold, fontSize: 15, fontWeight: "600", textAlign: "left" },
  files: { fontFamily: fontFamily.semiBold, fontSize: 15, fontWeight: "600", marginTop: 6, textAlign: "center" },
  status: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 },
  statusText: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800", textAlign: "center" },
  statusFlex: { flexShrink: 1 },
});
