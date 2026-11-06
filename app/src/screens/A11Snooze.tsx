/**
 * A11 Snooze: the sheet that offers 5 minutes, 10 minutes or Until I'm back. Prototype:
 * `openSheet("snooze")` and `.sopt` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` A11, `User journeys.md` J8.
 *
 * `onChoose(until)` gets epoch ms, or null for "until I'm back". The host wires it to
 * `answers.snooze({clientId, questionId, until})`. The sheet closes itself when `onChoose`
 * resolves; if it rejects, the sheet stays open and shows the error so he can try again.
 * The same sheet serves the one-option swipe, whose Snooze sits on the track (Q17).
 */
import { anyApi } from "convex/server";
import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text } from "react-native";
import { readableError } from "../session";
import { SNOOZE_CHOICES, snoozeSheetText, snoozeUntil, type SnoozeChoice } from "../receiptCopy";
import { ICON } from "../ui/AlertFrame";
import type { BlobBot } from "../ui/blobShapes";
import { Sheet, SheetOption, SheetOptionIcon, SheetText, SheetTitle } from "../ui/Sheet";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";

export interface A11SnoozeProps {
  visible: boolean;
  onClose: () => void;
  bot: BlobBot;
  /** Snoozes the alert. `until` is epoch ms, or null for "until I'm back". */
  onChoose: (until: number | null) => Promise<void>;
}

export function A11Snooze({ visible, onClose, bot, onChoose }: A11SnoozeProps) {
  const t = useTheme().tokens;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setBusy(false);
      setError(null);
    }
  }, [visible]);

  async function choose(choice: SnoozeChoice) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChoose(snoozeUntil(choice, Date.now()));
      onClose();
    } catch (caught) {
      setError(readableError(caught));
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={busy ? () => {} : onClose} testID="a11-snooze">
      <SheetTitle>Snooze</SheetTitle>
      <SheetText>{snoozeSheetText(bot.name)}</SheetText>
      {SNOOZE_CHOICES.map((choice) => (
        <SheetOption
          key={choice.id}
          label={choice.label}
          detail={choice.detail}
          icon={<SheetOptionIcon d={ICON.snooze} />}
          onPress={() => void choose(choice)}
          testID={`snooze-${choice.id}`}
        />
      ))}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.3}
          style={[styles.error, { color: t.warn }]}
        >
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    marginTop: 2,
    textAlign: "center",
  },
});

/**
 * "Until I'm back": when the app is opened or returns to the foreground, this client's untimed
 * snoozed alerts go back to pending (`alerts.wakeSnoozed`, no push). Mount it once, signed in.
 * Errors are ignored: the next time the app comes forward tries again.
 */
export function useWakeSnoozed(clientId: string | null): void {
  const client = useConvex();
  useEffect(() => {
    if (!clientId) return;
    const wake = () => {
      client.mutation(anyApi.alerts.wakeSnoozed, { clientId }).catch(() => {});
    };
    wake();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") wake();
    });
    return () => subscription.remove();
  }, [client, clientId]);
}
