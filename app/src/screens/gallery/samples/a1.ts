/**
 * Sample alerts for A1 Choice, single, copied from the prototype's `ALERTS` table
 * (`vault/Projects/Puck/mockups/Puck prototype.html`): `ship` (the Sheldon sample) and `fyi`.
 *
 * Times are relative: `createdAt` is 0 and `expiresAt` is the alert's whole life in ms.
 * `freshSample()` in `index.ts` moves them to "now" when a sample is opened.
 */
import type { PendingAlert } from "../../../ChoiceScreen";

/** `ship`: Sheldon, a normal alert with message, details, link, a 12 minute expiry and three described options. */
export const sheldon: PendingAlert = {
  questionId: "q_SAMPLE00SHELDON1",
  question: "Ship the 0.3 build tonight?",
  botId: "sheldon-23648",
  botName: "Sheldon",
  priority: "normal",
  selectionMode: "single",
  presentation: "choice",
  message: "All checks passed. Two small UI fixes since 0.2.",
  details:
    "Changes since 0.2\n• Swipe waits 400 ms before arming\n• Answered alerts clear from the shade\n\nBuild 0.3.0 (41) · 12.4 MB\n86 of 86 tests passed",
  link: { label: "Open in Sheldon", url: "https://example.com/sheldon" },
  expiresAt: 12 * 60 * 1000,
  options: [
    { id: "ship", label: "Ship it", rec: true, desc: "Builds `0.3.0 (41)` and posts it to the **beta** channel." },
    { id: "wait", label: "Wait till morning", desc: "I'll ship at *9 AM* and remind you first." },
    {
      id: "skip",
      label: "Skip this one",
      tone: "destructive",
      desc: "Drops this build. The fixes move to `0.3.1`.",
    },
  ],
  createdAt: 0,
};

/** `fyi`: Deploy Watch, one option, so one tap answers it (Q27). */
export const fyi: PendingAlert = {
  questionId: "q_SAMPLE00000FYI01",
  question: "0.3.0 is live",
  botId: "deploy-watch-48213",
  botName: "Deploy Watch",
  priority: "normal",
  selectionMode: "single",
  presentation: "choice",
  message: "Deployed at 21:52. The error rate is back to **0.4%**.",
  options: [{ id: "ok", label: "Got it" }],
  createdAt: 0,
};

export const A1_SAMPLES: Record<string, PendingAlert> = { sheldon, fyi };
