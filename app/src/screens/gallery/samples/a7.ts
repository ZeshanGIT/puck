/**
 * Sample alert for A7 (receipt) and A9 (no longer needed): `expiring` expires 20 seconds after it
 * is opened, so the Missed and expired path can be seen (`puck://dev-alert?sample=expiring`).
 *
 * Times are relative, as in `a1.ts`: `createdAt` is 0 and `expiresAt` is the alert's whole life in
 * ms; `freshSample()` in `index.ts` moves them to "now".
 */
import type { PendingAlert } from "../../../ChoiceScreen";

/** Deploy Watch asks something that is only worth answering for 20 seconds. */
export const expiring: PendingAlert = {
  questionId: "q_SAMPLE0EXPIRING1",
  question: "Roll back the deploy?",
  botId: "deploy-watch-48213",
  botName: "Deploy Watch",
  priority: "normal",
  selectionMode: "single",
  presentation: "choice",
  message: "The error rate passed **5%** two minutes ago. This question expires in 20 seconds.",
  expiresAt: 20 * 1000,
  options: [
    { id: "rollback", label: "Roll back", rec: true },
    { id: "keep", label: "Keep it" },
  ],
  createdAt: 0,
};

export const A7_SAMPLES: Record<string, PendingAlert> = { expiring };
