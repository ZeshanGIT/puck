/**
 * A2 Choice, multi: any number of options. Prototype: the `multi` branch of `alertBody`, with
 * `ACT.check`, `ACT.selall`, `ACT.send` and `updSend()` (`vault/Projects/Puck/mockups/Puck prototype.html`).
 *
 * - Checking is free: a tap toggles the option (the blob squashes), no arm, no timer.
 *   "Select all" checks every option, or clears them when they are all checked.
 * - "Send N" is the tap-twice control: disabled at 0, "Send 2" at rest, the first tap arms it
 *   ("Tap again to send 2", the blob looks down, a timer bar drains for 4 s), the second tap
 *   sends. Changing the selection while it is armed disarms it, as `updSend()` does.
 * - A send makes the blob leap, and the host's receipt (A7) takes the bottom. `onAnswer` gets the
 *   ids in the order of the options. If it throws, a Toast shows the error and the checks stay as
 *   they were.
 * - `expiresAt` counts down in the pill; when it passes, the options, Select all and Send are
 *   disabled and the pill says Missed (the host then shows the A9 card).
 * - Reply (A5) and Snooze (A11) come from the host (`AlertHost`): `onReply` and `onSnooze`. Without
 *   them tapping either shows a Toast. The receipt and the A9 card are the host's too (`receipt`,
 *   `gone`).
 *
 * Not here: the ringing, DND, spoken text and the night decision (card T34), the unlock check
 * for destructive options on the lock screen (Q10), a reply sent with the checked options (A5),
 * and the stack of several alerts (A8).
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { PendingAlert } from "../ChoiceScreen";
import { emptyChoice, tapOption, toggleAll, type ChoiceState } from "../choice";
import { readableError } from "../session";
import { AlertFrame, AlertSecondaryRow, useExpiry } from "../ui/AlertFrame";
import { ArmTimer } from "../ui/ArmTimer";
import type { BlobHandle } from "../ui/Blob";
import type { Offset } from "../ui/blobShapes";
import type { ThemeBot } from "../ui/botTheme";
import { botLook } from "../ui/botLook";
import { CheckOption } from "../ui/CheckOption";
import { useBotTheme, useTheme } from "../ui/theme";
import { Toast, useToast } from "../ui/Toast";
import { fontFamily, radii } from "../ui/tokens";
import { haptics, useTapTwice } from "../ui/useTapTwice";

export interface A2ChoiceMultiProps {
  alert: PendingAlert;
  /** How many alerts are waiting, this one included. */
  waiting: number;
  /** Sends the answer. Rejecting shows the error and re-enables the options. */
  onAnswer: (optionIds: string[], customReply?: string) => Promise<void>;
  /** Opens the reply sheet (A5). */
  onReply?: () => void;
  /** Opens the snooze choices (A11). */
  onSnooze?: () => void;
  /** Night look; the caller decides when it is night (card T34). */
  night?: boolean;
  /** True only while the phone is really reading the message aloud (card T34). */
  readingAloud?: boolean;
  /** The lock-screen clock at the top (an urgent alert over the lock screen). */
  clock?: boolean;
  /**
   * The A7 receipt, owned by the host (`AlertHost`): it covers the options once an answer is in,
   * whether the answer came from here or from the reply sheet.
   */
  receipt?: ReactNode;
  /** The A9 card, over a dimmed alert, when the alert is no longer needed. */
  gone?: ReactNode;
}

/** `look(mainBlob(),0,4)` in `ACT.send`. */
const SEND_LOOK: Offset = { x: 0, y: 4 };
const MAX_FONT_SCALE = 1.3;

type Phase = "idle" | "sending" | "sent";

export function A2ChoiceMulti({
  alert,
  waiting,
  onAnswer,
  onReply,
  onSnooze,
  night,
  readingAloud,
  clock,
  receipt,
  gone,
}: A2ChoiceMultiProps) {
  const { botId, botName } = alert;
  const bot = useMemo(() => botLook({ botId, botName }), [botId, botName]);
  const expiry = useExpiry(alert.expiresAt, alert.createdAt);
  const toast = useToast();
  const blob = useRef<BlobHandle>(null);
  const [choice, setChoice] = useState<ChoiceState>(emptyChoice);
  const [look, setLook] = useState<Offset | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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

  // An answer made from the reply sheet (A5) skips `send`, so the blob leaps when the receipt arrives.
  const hasReceipt = receipt != null;
  useEffect(() => {
    if (hasReceipt && !busy.current) blob.current?.leap();
  }, [hasReceipt]);

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

  const onSendArmedChange = useCallback((armed: boolean) => {
    setLook(armed ? SEND_LOOK : null);
  }, []);

  async function send() {
    if (busy.current) return;
    // In the order of the options, whatever order the checks were made in.
    const chosen = options.filter((o) => selectedIds.includes(o.id));
    if (chosen.length === 0) return;
    busy.current = true;
    setLook(null);
    setPhase("sending");
    blob.current?.leap();
    try {
      await onAnswer(chosen.map((o) => o.id));
      if (alive.current) setPhase("sent");
    } catch (caught) {
      if (!alive.current) return;
      busy.current = false;
      setPhase("idle");
      haptics.error();
      toast.show(readableError(caught));
    }
  }

  async function openLink() {
    const url = alert.link?.url;
    try {
      if (!url || !/^https?:\/\//iu.test(url)) throw new Error("not a web link");
      await Linking.openURL(url);
    } catch {
      toast.show("Couldn't open the link");
    }
  }

  const comingLater = () => toast.show("Coming in a later step");
  const expired = expiry?.expired === true;
  // `size = ... (a.options.some(o=>o.desc) ? (a.options.length>3 ? 84 : 112) : 156)`
  const blobSize = options.some((o) => o.desc) ? (options.length > 3 ? 84 : 112) : 156;

  return (
    <AlertFrame
      bot={bot}
      priority={alert.priority}
      question={alert.question}
      createdAt={alert.createdAt}
      message={alert.message}
      details={alert.details}
      link={alert.link}
      onOpenLink={() => void openLink()}
      expiry={expiry}
      readingAloud={readingAloud}
      queue={waiting > 1 ? { position: 1, total: waiting } : null}
      night={night}
      clock={clock}
      answered={phase !== "idle" || receipt != null}
      dimmed={gone != null}
      blobRef={blob}
      blobSize={blobSize}
      look={look}
      bottom={
        receipt != null ? (
          receipt
        ) : phase === "idle" ? (
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
            <SendButton
              count={count}
              bot={bot}
              disabled={expired || count === 0}
              onArmedChange={onSendArmedChange}
              onConfirm={() => void send()}
            />
            <AlertSecondaryRow onReply={onReply ?? comingLater} onSnooze={onSnooze ?? comingLater} />
          </>
        ) : null
      }
      overlay={
        <>
          {gone}
          <Toast message={toast.message} visible={toast.visible} />
        </>
      }
    />
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

/** `rgba` of a `#rrggbb` colour (the prototype mixes the bar colour at 72% with transparent). */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const SEND_HEIGHT = 62;
const SEND_LIFT = 3;
const SEND_DISABLED_OPACITY = 0.32;
const SEND_SPRING = { damping: 14, stiffness: 200, mass: 1 } as const;

/**
 * `.send`: a full-width bot-coloured tap-twice button, 62 dp tall with a 5 dp edge. Armed lifts
 * 3 dp, draws a 7 dp edge and drains the bar; pressed drops 3 dp with a 1 dp edge. Built here
 * rather than on `Btn` because it must report arming (the blob looks down) and disarm itself
 * when the count changes.
 */
function SendButton({
  count,
  bot,
  disabled,
  onArmedChange,
  onConfirm,
}: {
  count: number;
  bot: ThemeBot;
  disabled: boolean;
  onArmedChange: (armed: boolean) => void;
  onConfirm: () => void;
}) {
  const bt = useBotTheme(bot);
  const reducedMotion = useReducedMotion();
  const twice = useTapTwice({ onConfirm });
  const { armed, disarm } = twice;
  const [pressed, setPressed] = useState(false);

  // `updSend()`: a change of the selection (or of whether Send may be used) drops the arm.
  useEffect(() => {
    disarm();
  }, [count, disabled, disarm]);

  useEffect(() => {
    onArmedChange(armed);
  }, [armed, onArmedChange]);

  const label = count === 0 ? "Send" : armed ? `Tap again to send ${count}` : `Send ${count}`;

  const down = pressed && !armed && !disabled;
  const edge = down ? 1 : armed ? 7 : 5;
  const target = armed ? -SEND_LIFT : down ? SEND_LIFT : 0;
  const translateY = useSharedValue(0);
  useEffect(() => {
    translateY.value = reducedMotion ? target : withSpring(target, SEND_SPRING);
  }, [target, reducedMotion, translateY]);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={armed ? "Tap again to confirm" : "Tap twice to send"}
      accessibilityState={{ disabled }}
      accessibilityLiveRegion={armed ? "polite" : "none"}
      disabled={disabled}
      onPress={twice.press}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.sendOuter, disabled ? { opacity: SEND_DISABLED_OPACITY } : null]}
    >
      <Animated.View
        style={[
          styles.send,
          {
            backgroundColor: bt.sendBg,
            boxShadow: [{ offsetX: 0, offsetY: edge, blurRadius: 0, spreadDistance: 0, color: bt.botDeep }],
          },
          moved,
        ]}
      >
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.sendText, { color: bt.onBot }]}
        >
          {label}
        </Text>
        {armed ? (
          <ArmTimer color={withAlpha(bt.onBot, 0.72)} armedAt={twice.armedAt} bottom={8} inset={24} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  selall: { flexDirection: "row", justifyContent: "flex-end", marginTop: -2, marginHorizontal: 2, marginBottom: 10 },
  selallDisabled: { opacity: 0.32 },
  selallText: { fontFamily: fontFamily.extraBold, fontSize: 14, fontWeight: "800" },
  opts: { gap: 12 },
  sendOuter: { alignSelf: "stretch", marginTop: 14 },
  send: {
    height: SEND_HEIGHT,
    borderRadius: radii.option,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  sendText: { fontFamily: fontFamily.black, fontSize: 18, fontWeight: "900" },
});
