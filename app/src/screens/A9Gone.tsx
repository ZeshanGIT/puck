/**
 * A9 No longer needed: the bot cancelled the alert, it expired, or he answered it on another
 * client while he was looking at it. Prototype: `goneCard` and `.gone`, `.dim`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` A9, `User journeys.md` J9.
 *
 * `A9Gone` is the card that sits over the bottom of the alert (a `.gone` block: 20 dp in from the
 * sides, 28 dp above the bottom). Pass it to `AlertFrame`'s `overlay`, and wrap the frame's
 * `bottom` content in `GoneDim` so the options go grey and stop taking touches. Work out `reason`
 * with `goneReason` from `@puck/shared` and `alerts.state` (see `useAlertGone`).
 *
 * It closes on a tap of Continue, as the doc says ("after a tap"). `autoCloseMs` also closes it by
 * itself after that long, for a host that wants it (an alert over the lock screen).
 */
import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import { goneReason, type AlertStatus } from "@puck/shared";
import { useEffect, useRef, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { goneCopy, type GoneViewReason } from "../receiptCopy";
import { Btn } from "../ui/Btn";
import type { BlobBot } from "../ui/blobShapes";
import { useTheme } from "../ui/theme";
import { fontFamily, radii } from "../ui/tokens";

const MAX_FONT_SCALE = 1.3;

export interface A9GoneProps {
  bot: BlobBot;
  reason: GoneViewReason;
  /** The client that answered, for `answeredElsewhere` ("MacBook"). */
  clientName?: string;
  /** What he chose there ("Ship it"). */
  answerLabels?: string[];
  /** When it expired, epoch ms, for `expired`. */
  expiredAt?: number;
  /** Closes the card by itself after this many ms. Left out, only a tap closes it. */
  autoCloseMs?: number;
  /** Called once: the host moves on to the next alert, or back. */
  onDone: () => void;
}

export function A9Gone({ bot, reason, clientName, answerLabels, expiredAt, autoCloseMs, onDone }: A9GoneProps) {
  const t = useTheme().tokens;
  const copy = goneCopy({
    reason,
    botName: bot.name,
    ...(clientName === undefined ? {} : { clientName }),
    ...(answerLabels === undefined ? {} : { answerLabels }),
    ...(expiredAt === undefined ? {} : { expiredAt }),
  });
  const done = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finish = () => {
    if (done.current) return;
    done.current = true;
    doneRef.current();
  };

  useEffect(() => {
    if (autoCloseMs === undefined) return;
    const id = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      doneRef.current();
    }, autoCloseMs);
    return () => clearTimeout(id);
  }, [autoCloseMs]);

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.gone, { backgroundColor: t.card, borderColor: t.line }]}
    >
      <View accessible accessibilityLabel={copy.sub ? `${copy.title}. ${copy.sub}` : copy.title}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: t.ink }]}>
          {copy.title}
        </Text>
        {copy.sub ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: t.ink2 }]}>
            {copy.sub}
          </Text>
        ) : (
          <View style={styles.noSub} />
        )}
      </View>
      <Btn label="Continue" variant="line" onPress={finish} />
    </View>
  );
}

/** `.dim`: the alert's options once it is gone. Opacity .35, a little grey, no touches. */
export function GoneDim({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <View
      pointerEvents={active ? "none" : "auto"}
      importantForAccessibility={active ? "no-hide-descendants" : "auto"}
      style={active ? styles.dim : null}
    >
      {children}
    </View>
  );
}

export interface AlertGoneState {
  reason: GoneViewReason;
  clientName?: string;
  answerLabels?: string[];
  expiredAt?: number;
}

/**
 * Watches `alerts.state` for the alert on screen and says when it is no longer pending. Null while
 * it still is. `ownClientName` is this phone's client name, so his own answer is not "elsewhere".
 * `now` is only for the expiry check; it re-renders as `alerts.state` changes, and the screen's
 * own `useExpiry` already ticks at `expiresAt`. Needs the Convex provider and a client id.
 */
export function useAlertGone(input: {
  clientId: string | null;
  questionId: string;
  ownClientName: string | null;
  now?: number;
}): AlertGoneState | null {
  const state = useQuery(
    anyApi.alerts.state,
    input.clientId ? { clientId: input.clientId, questionId: input.questionId } : "skip",
  ) as
    | { status: AlertStatus; answeredByClientName: string | null; expiresAt: number | null; answerLabels?: string[] }
    | null
    | undefined;
  if (!state) return null;
  const reason = goneReason({
    status: state.status,
    expiresAt: state.expiresAt,
    answeredByClientName: state.answeredByClientName,
    ownClientName: input.ownClientName,
    now: input.now ?? Date.now(),
  });
  if (reason === null) return null;
  return {
    reason,
    ...(state.answeredByClientName ? { clientName: state.answeredByClientName } : {}),
    ...(state.answerLabels && state.answerLabels.length > 0 ? { answerLabels: state.answerLabels } : {}),
    ...(state.expiresAt !== null ? { expiredAt: state.expiresAt } : {}),
  };
}

const styles = StyleSheet.create({
  gone: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 28,
    zIndex: 5,
    borderRadius: radii.card,
    borderWidth: 1.5,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: "stretch",
    boxShadow: "0px 16px 40px rgba(0, 0, 0, 0.12)",
  },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  sub: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 14,
  },
  noSub: { height: 14 },
  dim: { opacity: 0.35, filter: [{ grayscale: 0.4 }] },
});
