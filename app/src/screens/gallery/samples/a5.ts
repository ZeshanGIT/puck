/**
 * Sample alert for A5 Custom reply. The prototype has no reply-only sample (its reply sheet opens
 * over any alert), so this is a single choice named `reply-demo`, built from the prototype's `ship`
 * alert: open it, tap Reply, and try the text field, dictation, camera, photo and file.
 *
 * Times are relative, as in `a1.ts`: `createdAt` is 0 and `freshSample()` moves it to "now".
 */
import type { PendingAlert } from "../../../ChoiceScreen";

export const replyDemo: PendingAlert = {
  questionId: "q_SAMPLE00REPLY001",
  question: "Ship the 0.3 build tonight?",
  botId: "sheldon-23648",
  botName: "Sheldon",
  priority: "normal",
  selectionMode: "single",
  presentation: "choice",
  message: "All checks passed. Two small UI fixes since 0.2.",
  options: [
    { id: "ship", label: "Ship it", rec: true },
    { id: "wait", label: "Wait till morning" },
  ],
  createdAt: 0,
};

export const A5_SAMPLES: Record<string, PendingAlert> = { "reply-demo": replyDemo };
