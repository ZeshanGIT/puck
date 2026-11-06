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
import { useCallback, useState } from "react";
import { type PendingAlert, ChoiceScreen } from "../ChoiceScreen";
import { replyPayload } from "../choice";
import { readClientId } from "../clientStore";
import { useReadingAloud } from "../speak";
import { ensureUnlockedFor } from "../unlock";
import { clearDisplayedAlert, useUrgentLook } from "../urgentDisplay";
import type { UploadedAttachment } from "../attachments";
import { A1ChoiceSingle } from "./A1ChoiceSingle";
import { A2ChoiceMulti } from "./A2ChoiceMulti";
import { A3Swipe } from "./A3Swipe";
import { A5Reply } from "./A5Reply";

export type AnswerHandler = (optionIds: string[], customReply?: string, attachments?: UploadedAttachment[]) => Promise<void>;

export interface AlertHostProps {
  alert: PendingAlert;
  /** How many alerts are waiting, this one included. */
  waiting: number;
  onAnswer?: AnswerHandler;
}

export function AlertHost({ alert, waiting, onAnswer }: AlertHostProps) {
  return onAnswer ? (
    // An explicit `onAnswer` is the dev sample route: there is no backend, so no uploads either.
    <AlertScreen alert={alert} waiting={waiting} onAnswer={onAnswer} sample />
  ) : (
    <ConnectedAlertHost alert={alert} waiting={waiting} />
  );
}

/** The default `onAnswer`: needs the Convex provider, which is why it is split off. */
function ConnectedAlertHost({ alert, waiting }: { alert: PendingAlert; waiting: number }) {
  const record = useMutation(anyApi.answers.record);
  const { questionId } = alert;
  const onAnswer = useCallback<AnswerHandler>(
    async (optionIds, customReply, attachments) => {
      // `replyPayload` trims the reply and refuses an empty answer, as `ChoiceScreen` does.
      // A reply that is only attachments is allowed.
      // On the lock screen a destructive option, or a `requiresUnlock` alert, asks to unlock first.
      // A throw here reaches the screen as a Toast and keeps the alert up (Q9, Q10).
      await ensureUnlockedFor(alert, optionIds);
      const hasFiles = (attachments?.length ?? 0) > 0;
      const payload = hasFiles
        ? { optionIds, customReply: (customReply ?? "").trim() }
        : replyPayload({
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
        ...(hasFiles ? { attachments } : {}),
      });
      await clearDisplayedAlert(questionId);
      if (waiting <= 1) leaveIfLocked();
    },
    [record, questionId, waiting, alert],
  );
  return <AlertScreen alert={alert} waiting={waiting} onAnswer={onAnswer} />;
}

function AlertScreen({
  alert,
  waiting,
  onAnswer,
  sample,
}: AlertHostProps & { onAnswer: AnswerHandler; sample?: boolean }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const openReply = useCallback(() => setReplyOpen(true), []);
  return (
    <>
      <AlertBody alert={alert} waiting={waiting} onAnswer={onAnswer} onReply={openReply} />
      <A5Reply
        visible={replyOpen}
        onClose={() => setReplyOpen(false)}
        alert={alert}
        onSend={async (optionIds, customReply, attachments) => {
          await onAnswer(optionIds, customReply, attachments);
          setReplyOpen(false);
        }}
        getUploadUrl={sample ? () => Promise.reject(new Error("Uploads need a real alert")) : undefined}
      />
    </>
  );
}

function AlertBody({
  alert,
  waiting,
  onAnswer,
  onReply,
}: AlertHostProps & { onAnswer: AnswerHandler; onReply: () => void }) {
  // Urgent over the lock screen: the clock, and the night look from 10 PM to 7 AM (card T34).
  const look = useUrgentLook(alert.priority);
  const readingAloud = useReadingAloud(alert.questionId);
  const frame = { night: look.night, clock: look.clock, readingAloud };
  if (alert.selectionMode === "single" && alert.presentation === "choice") {
    // Keyed by the question so the next alert starts fresh (blob arrives, nothing armed).
    return <A1ChoiceSingle key={alert.questionId} alert={alert} waiting={waiting} onAnswer={onAnswer} onReply={onReply} {...frame} />;
  }
  if (alert.selectionMode === "multi" && alert.presentation === "choice") {
    return <A2ChoiceMulti key={alert.questionId} alert={alert} waiting={waiting} onAnswer={onAnswer} onReply={onReply} {...frame} />;
  }
  if (alert.presentation === "swipe") {
    return <A3Swipe key={alert.questionId} alert={alert} waiting={waiting} onAnswer={onAnswer} onReply={onReply} {...frame} />;
  }
  // The POC screens record the answer themselves and ignore `onAnswer`. Nothing reaches them now
  // that A1, A2 and A3 cover every alert; the old screens stay until the old Inbox is replaced.
  return <ChoiceScreen alert={alert} waiting={waiting} />;
}
