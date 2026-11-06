/**
 * Sample alerts for A2 Choice, multi, copied from the prototype's `ALERTS` table
 * (`vault/Projects/Puck/mockups/Puck prototype.html`): `tidy` (the Brow sample), registered as
 * `brow-multi`. The prototype has no other multi alert.
 *
 * Times are relative, as in `a1.ts`: `createdAt` is 0 and `freshSample()` in `index.ts` moves it
 * to "now" when the sample is opened. The prototype's `tidy` has no expiry, so there is no
 * `expiresAt`.
 */
import type { PendingAlert } from "../../../ChoiceScreen";

/** `tidy`: Brow, a normal alert with a message and four described options, one recommended. */
export const browMulti: PendingAlert = {
  questionId: "q_SAMPLE0000BROW01",
  question: "Which of these should I tidy up?",
  botId: "brow-50917",
  botName: "Brow",
  priority: "normal",
  selectionMode: "multi",
  presentation: "choice",
  message: "I'll archive old files and sort the rest into folders. Nothing gets deleted.",
  options: [
    { id: "inbox", label: "Inbox", desc: "**23** threads older than a month go to the archive." },
    { id: "schedule", label: "Schedule", rec: true, desc: "Past events move to `Archive/2026`." },
    { id: "downloads", label: "Downloads", desc: "**214** files, 1.8 GB, sorted by type." },
    { id: "desktop", label: "Desktop", desc: "Screenshots older than a week." },
  ],
  createdAt: 0,
};

export const A2_SAMPLES: Record<string, PendingAlert> = { "brow-multi": browMulti };
