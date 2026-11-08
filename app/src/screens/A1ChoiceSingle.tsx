/**
 * A1 Choice, single: one answer from one or more options. Prototype: `alertScreen` and the
 * `single` branch of `alertBody`, with `ACT.opt` for the arm and send behaviour
 * (`vault/Projects/Puck/mockups/Puck prototype.html`).
 *
 * - Tap twice: the first tap arms an option (the blob looks at it and squashes, a timer bar
 *   drains for 4 s), the second tap sends it. Arming another option moves the arm. One option
 *   (an FYI alert, Q27) is one tap with no arm.
 * - A send makes the blob leap, and the host's receipt (A7) takes the bottom. If `onAnswer`
 *   throws, a Toast shows the error and the options come back.
 * - `expiresAt` counts down in the pill; when it passes the options are disabled and the pill
 *   says Missed (the host then shows the A9 card).
 * - Reply (A5) and Snooze (A11) come from the host (`AlertHost`): `onReply` and `onSnooze`. Without
 *   them tapping either shows a Toast.
 * - The receipt (A7) and the "no longer needed" card (A9) are the host's too: pass them as
 *   `receipt` and `gone`.
 *
 * Not here: the ringing, DND, spoken text and the night decision (card T34), the unlock check
 * for destructive options on the lock screen (Q10), and the stack of several alerts (A8).
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import type { PendingAlert } from "../ChoiceScreen";
import { readableError } from "../session";
import { AlertFrame, AlertSecondaryRow, useExpiry } from "../ui/AlertFrame";
import type { BlobHandle } from "../ui/Blob";
import type { Offset } from "../ui/blobShapes";
import { botLook } from "../ui/botLook";
import { OptionButton } from "../ui/OptionButton";
import { useTheme } from "../ui/theme";
import { Toast, useToast } from "../ui/Toast";
import { fontFamily } from "../ui/tokens";
import { haptics, TapTwiceGroup } from "../ui/useTapTwice";
import { snoozeOf } from "../alertExpiry";

export interface A1ChoiceSingleProps {
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

/** `look(mainBlob(), -1, 4)` in `ACT.opt`. */
const ARM_LOOK: Offset = { x: -1, y: 4 };
/** `if(Date.now()-S.armedAt<350) return;` in `ACT.opt`: ignores a stale touch just after the screen opens. */
const STALE_TOUCH_MS = 350;
const MAX_FONT_SCALE = 1.3;

/** `S.answeredOnce`: the "Tap twice to answer" hint goes away after the first answer. */
let answeredOnce = false;
function markAnswered() {
  answeredOnce = true;
}

type Phase = "idle" | "sending" | "sent";

export function A1ChoiceSingle(props: A1ChoiceSingleProps) {
  return (
    <TapTwiceGroup>
      <A1Body {...props} />
    </TapTwiceGroup>
  );
}

function A1Body({ alert, waiting, onAnswer, onReply, onSnooze, night, readingAloud, clock, receipt, gone }: A1ChoiceSingleProps) {
  const { botId, botName } = alert;
  const bot = useMemo(() => botLook({ botId, botName }), [botId, botName]);
  const expiry = useExpiry(alert.expiresAt, alert.createdAt, snoozeOf(alert));
  const toast = useToast();
  const blob = useRef<BlobHandle>(null);
  const armedIds = useRef(new Set<string>());
  const [look, setLook] = useState<Offset | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    const id = setTimeout(() => setReady(true), STALE_TOUCH_MS);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // An answer made from the reply sheet (A5) skips `send`, so the blob leaps when the receipt arrives.
  const hasReceipt = receipt != null;
  useEffect(() => {
    if (hasReceipt && !busy.current) blob.current?.leap();
  }, [hasReceipt]);

  const onArmedChange = useCallback((id: string, armed: boolean) => {
    if (armed) {
      armedIds.current.add(id);
      blob.current?.squash();
    } else {
      armedIds.current.delete(id);
    }
    setLook(armedIds.current.size > 0 ? ARM_LOOK : null);
  }, []);

  async function send(optionId: string) {
    if (busy.current) return;
    busy.current = true;
    markAnswered();
    armedIds.current.clear();
    setLook(null);
    setPhase("sending");
    blob.current?.leap();
    try {
      await onAnswer([optionId]);
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
  const options = alert.options;
  const fyi = options.length === 1;
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
                  onConfirm={() => void send(option.id)}
                  onArmedChange={(armed) => onArmedChange(option.id, armed)}
                />
              ))}
            </View>
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

/** `.hint`: 13 / 800 ink3, centered, 10 dp above the options. */
function Hint({ children }: { children: string }) {
  const t = useTheme().tokens;
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[styles.hint, { color: t.ink3 }]}
    >
      {children}
    </Text>
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
  opts: { gap: 12 },
});
