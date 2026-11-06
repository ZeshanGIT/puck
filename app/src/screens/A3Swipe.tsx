/**
 * A3 Swipe: one answer by dragging toward it. Prototype: the swipe branch of `alertBody`,
 * `wireSwipe()` and `swipeCommit()` (`vault/Projects/Puck/mockups/Puck prototype.html`).
 *
 * - Two options: the first is the left side, the second the right. ONE option (an alarm, Q17):
 *   the option is the right side and the left side is Puck's own Snooze, which calls `onSnooze`
 *   (it is not an answer and sends nothing). With one option the secondary row has Reply only.
 * - The track (`SwipeTrack`) does the dragging, the haptics, the red knob toward a destructive
 *   side, the 400 ms arm delay, the stale-touch guard and the tap-twice route on the labels.
 *   While the knob is dragged the screen's blob looks toward that side (`look(big, dir*4, 3)`).
 * - A commit to an option makes the blob leap and shows the "You answered" receipt with
 *   "Sending…" while `onAnswer` is in flight, then "Sent". If `onAnswer` throws, a Toast shows
 *   the error and the track comes back, ready again.
 * - `expiresAt` counts down in the pill; when it passes the track is disabled and the pill says
 *   Missed (the A9 screen comes later).
 * - Reply (A5) and Snooze (A11) are built by later cards: `onReply` and `onSnooze` are theirs to
 *   supply. Until then tapping Reply, or committing to Snooze, shows a Toast and the knob springs
 *   home.
 *
 * Not here: the ringing, DND, spoken text and the night decision (card T34), the unlock check
 * for destructive options on the lock screen (Q10), and the stack of several alerts (A8).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { PendingAlert } from "../ChoiceScreen";
import { Spinner } from "../onboarding/parts";
import { readableError } from "../session";
import { AlertFrame, AlertSecondaryRow, Glyph, ICON, useExpiry } from "../ui/AlertFrame";
import type { BlobHandle } from "../ui/Blob";
import type { Offset } from "../ui/blobShapes";
import { botLook } from "../ui/botLook";
import { SwipeTrack, type SwipeSide, type SwipeSideSpec, type SwipeTrackHandle } from "../ui/SwipeTrack";
import { useTheme } from "../ui/theme";
import { Toast, useToast } from "../ui/Toast";
import { fontFamily, radii } from "../ui/tokens";
import { haptics } from "../ui/useTapTwice";

export interface A3SwipeProps {
  alert: PendingAlert;
  /** How many alerts are waiting, this one included. */
  waiting: number;
  /** Sends the answer. Rejecting shows the error and brings the track back. */
  onAnswer: (optionIds: string[], customReply?: string) => Promise<void>;
  /** Opens the reply sheet (A5). */
  onReply?: () => void;
  /** Puck's Snooze: opens the snooze choices (A11). The swipe's one-option form has it on the left. */
  onSnooze?: () => void;
  /** Night look; the caller decides when it is night (card T34). */
  night?: boolean;
  /** True only while the phone is really reading the message aloud (card T34). */
  readingAloud?: boolean;
  /** The lock-screen clock at the top (an urgent alert over the lock screen). */
  clock?: boolean;
}

const MAX_FONT_SCALE = 1.3;
/** `look(big, v>0?4:(v<0?-4:0), 3)` while the knob is dragged. */
const LOOK_Y = 3;
const LOOK_X = 4;

/** The prototype's `ICON.undo`; `option.icon` names an icon and the track draws its path. */
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

type Phase = "idle" | "sending" | "sent";

export function A3Swipe({ alert, waiting, onAnswer, onReply, onSnooze, night, readingAloud, clock }: A3SwipeProps) {
  const { botId, botName } = alert;
  const bot = useMemo(() => botLook({ botId, botName }), [botId, botName]);
  const expiry = useExpiry(alert.expiresAt, alert.createdAt);
  const toast = useToast();
  const blob = useRef<BlobHandle>(null);
  const track = useRef<SwipeTrackHandle>(null);
  const [look, setLook] = useState<Offset | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState("");
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const options = alert.options;
  const oneOption = options.length === 1;
  const valid = options.length === 1 || options.length === 2;
  const expired = expiry?.expired === true;

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

  const comingLater = () => toast.show("Coming in a later step");

  async function send(optionId: string, label: string) {
    if (busy.current) return;
    busy.current = true;
    setAnswer(label);
    setPhase("sending");
    blob.current?.leap();
    try {
      await onAnswer([optionId]);
      if (alive.current) setPhase("sent");
    } catch (caught) {
      if (!alive.current) return;
      busy.current = false;
      setLook(null);
      setPhase("idle");
      haptics.error();
      toast.show(readableError(caught));
    }
  }

  function onCommit(side: SwipeSide) {
    const option = side === "left" ? leftOption : rightOption;
    if (!option) {
      // Puck's Snooze: not an answer. The knob comes home; the snooze flow takes over from here.
      (onSnooze ?? comingLater)();
      track.current?.reset();
      return;
    }
    void send(option.id, option.label);
  }

  function onLookChange(direction: -1 | 0 | 1 | null) {
    setLook(direction === null ? null : { x: direction * LOOK_X, y: LOOK_Y });
  }

  function onArm(side: SwipeSide | null) {
    const spec = side === "left" ? leftSpec : side === "right" ? rightSpec : null;
    // `toast("Tap again to choose "+s.textContent.trim())`
    if (spec) toast.show(`Tap again to choose ${spec.label}`);
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

  const blobSize = night ? 128 : options.some((o) => o.desc) ? (options.length > 3 ? 84 : 112) : 156;

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
      answered={phase !== "idle"}
      blobRef={blob}
      blobSize={blobSize}
      look={look}
      bottom={
        phase !== "idle" ? (
          <>
            <Receipt answer={answer} sent={phase === "sent"} />
            <View style={styles.receiptGap} />
          </>
        ) : valid && leftSpec && rightSpec ? (
          <>
            <Hint>{oneOption ? "Drag right when you're up" : "Drag toward your answer"}</Hint>
            <SwipeTrack
              ref={track}
              left={leftSpec}
              right={rightSpec}
              bot={bot}
              disabled={expired}
              onCommit={onCommit}
              onLookChange={onLookChange}
              onArm={onArm}
            />
            <AlertSecondaryRow onReply={onReply ?? comingLater} onSnooze={oneOption ? undefined : (onSnooze ?? comingLater)} />
          </>
        ) : (
          <Hint>This swipe needs one or two options.</Hint>
        )
      }
      overlay={<Toast message={toast.message} visible={toast.visible} />}
    />
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

/** `.swipehint`: 13 / 800 ink3, centered, 10 dp above the track. */
function Hint({ children }: { children: string }) {
  const t = useTheme().tokens;
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: t.ink3 }]}>
      {children}
    </Text>
  );
}

/** `.receipt` in its sending and sent states, as A1 draws it (the A7 screen builds on this later). */
function Receipt({ answer, sent }: { answer: string; sent: boolean }) {
  const t = useTheme().tokens;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`You answered ${answer}. ${sent ? "Sent" : "Sending"}`}
      style={[styles.receipt, { backgroundColor: t.card, borderColor: t.line }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.receiptLabel, { color: t.ink3 }]}>
        You answered
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.receiptAnswer, { color: t.ink }]}>
        {answer}
      </Text>
      <View style={styles.status}>
        {sent ? <Glyph d={ICON.check} size={18} colour={t.ink2} width={2.6} /> : <Spinner />}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusText, { color: t.ink2 }]}>
          {sent ? "Sent" : "Sending…"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    textAlign: "center",
    fontFamily: fontFamily.extraBold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 13 * 0.01,
    marginBottom: 10,
  },
  receipt: {
    alignItems: "center",
    borderRadius: radii.card,
    borderWidth: 1.5,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  receiptLabel: {
    fontFamily: fontFamily.extraBold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 13 * 0.07,
    textTransform: "uppercase",
  },
  receiptAnswer: {
    fontFamily: fontFamily.black,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 6,
    textAlign: "center",
  },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  statusText: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800" },
  receiptGap: { height: 52 },
});
