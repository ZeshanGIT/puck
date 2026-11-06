/**
 * The one place that turns a `PendingAlert` into a screen.
 *
 * - `selectionMode: "single"` with `presentation: "choice"` is A1 (`A1ChoiceSingle`).
 * - Everything else (multi, swipe) still uses the proof-of-concept `ChoiceScreen` and
 *   `SwipeScreen`, exactly as `Inbox` did before. Other cards replace those two branches (A2
 *   multi, A3 swipe); add the new screen here and nowhere else.
 *
 * `onAnswer` sends the answer. Left out, it records the answer with `answers.record` for this
 * phone's client id, as `ChoiceScreen` does, clears the shade copy and leaves the lock screen
 * when nothing else is waiting. Pass your own to keep the backend out of it (the dev sample
 * route `puck://dev-alert` does).
 */
import { anyApi } from "convex/server";
import { useMutation } from "convex/react";
import { leaveIfLocked } from "puck-full-screen";
import { useCallback } from "react";
import { type PendingAlert, ChoiceScreen } from "../ChoiceScreen";
import { replyPayload } from "../choice";
import { readClientId } from "../clientStore";
import { clearDisplayedAlert } from "../urgentDisplay";
import { A1ChoiceSingle } from "./A1ChoiceSingle";
import { A2ChoiceMulti } from "./A2ChoiceMulti";
import { A3Swipe } from "./A3Swipe";

export type AnswerHandler = (optionIds: string[], customReply?: string) => Promise<void>;

export interface AlertHostProps {
  alert: PendingAlert;
  /** How many alerts are waiting, this one included. */
  waiting: number;
  onAnswer?: AnswerHandler;
}

export function AlertHost({ alert, waiting, onAnswer }: AlertHostProps) {
  return onAnswer ? (
    <AlertScreen alert={alert} waiting={waiting} onAnswer={onAnswer} />
  ) : (
    <ConnectedAlertHost alert={alert} waiting={waiting} />
  );
}

/** The default `onAnswer`: needs the Convex provider, which is why it is split off. */
function ConnectedAlertHost({ alert, waiting }: { alert: PendingAlert; waiting: number }) {
  const record = useMutation(anyApi.answers.record);
  const { questionId } = alert;
  const onAnswer = useCallback<AnswerHandler>(
    async (optionIds, customReply) => {
      // `replyPayload` trims the reply and refuses an empty answer, as `ChoiceScreen` does.
      const payload = replyPayload({
        mode: "multi",
        state: { armedId: null, selectedIds: optionIds },
        confirmId: null,
        customReply: customReply ?? "",
      });
      const clientId = await readClientId();
      await record({
        questionId,
        ...(clientId ? { clientId } : {}),
        optionIds: payload.optionIds,
        ...(payload.customReply ? { customReply: payload.customReply } : {}),
      });
      await clearDisplayedAlert(questionId);
      if (waiting <= 1) leaveIfLocked();
    },
    [record, questionId, waiting],
  );
  return <AlertScreen alert={alert} waiting={waiting} onAnswer={onAnswer} />;
}

function AlertScreen({ alert, waiting, onAnswer }: AlertHostProps & { onAnswer: AnswerHandler }) {
  if (alert.selectionMode === "single" && alert.presentation === "choice") {
    // Keyed by the question so the next alert starts fresh (blob arrives, nothing armed).
    return <A1ChoiceSingle key={alert.questionId} alert={alert} waiting={waiting} onAnswer={onAnswer} />;
  }
  if (alert.selectionMode === "multi" && alert.presentation === "choice") {
    return <A2ChoiceMulti key={alert.questionId} alert={alert} waiting={waiting} onAnswer={onAnswer} />;
  }
  if (alert.presentation === "swipe") {
    return <A3Swipe key={alert.questionId} alert={alert} waiting={waiting} onAnswer={onAnswer} />;
  }
  // The POC screens record the answer themselves and ignore `onAnswer`. Nothing reaches them now
  // that A1, A2 and A3 cover every alert; the old screens stay until the old Inbox is replaced.
  return <ChoiceScreen alert={alert} waiting={waiting} />;
}
