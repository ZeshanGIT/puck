/**
 * Sample alerts for A3 Swipe, copied from the prototype's `ALERTS` table
 * (`vault/Projects/Puck/mockups/Puck prototype.html`): `errors` (Deploy Watch, two sides, one
 * destructive) and `wake` (the 6 AM alarm, one option with Puck's Snooze on the other side).
 *
 * Times are relative: `createdAt` is 0 and `expiresAt` would be the alert's whole life in ms
 * (neither sample expires). `freshSample()` in `index.ts` moves them to "now" when opened.
 * The orchestrator registers `A3_SAMPLES` in `index.ts`.
 */
import type { PendingAlert } from "../../../ChoiceScreen";

/** `errors`: Deploy Watch, urgent, Roll back (destructive, left) or Keep watching (right). */
export const deployWatch: PendingAlert = {
  questionId: "q_SAMPLE0DEPLOYWT1",
  question: "API error rate is 14% and rising",
  botId: "deploy-watch-48213",
  botName: "Deploy Watch",
  priority: "urgent",
  selectionMode: "single",
  presentation: "swipe",
  message: "It started four minutes after the 21:30 deploy. p95 latency is 2.1 s.",
  details:
    "21:34:12  5xx 3.1%\n21:35:40  5xx 7.8%\n21:37:02  5xx 14.2%\nTop error: upstream timeout (payments)",
  options: [
    { id: "rollback", label: "Roll back", tone: "destructive", icon: "undo" },
    { id: "watch", label: "Keep watching" },
  ],
  createdAt: 0,
};

/** `wake`: Grok Bot, urgent, rings 5 minutes and reads aloud; one option, so the left side is Puck's Snooze. */
export const wake: PendingAlert = {
  questionId: "q_SAMPLE0000WAKE01",
  question: "Time to get up",
  botId: "grok-bot-11842",
  botName: "Grok Bot",
  priority: "urgent",
  selectionMode: "single",
  presentation: "swipe",
  message: "Flight to Delhi at 10:40. Leave by 8 and pack the charger.",
  ringSeconds: 300,
  speak: true,
  options: [{ id: "up", label: "I'm up" }],
  createdAt: 0,
};

export const A3_SAMPLES: Record<string, PendingAlert> = { "deploy-watch": deployWatch, wake };
