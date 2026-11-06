/**
 * Sample states for H1 Home (`puck://dev-alert?sample=home`, dev builds only, see `App.tsx`), with
 * no backend: what `alerts.waiting` and `alerts.history` would give, shaped by `homeModel.ts`.
 * They follow the prototype's "Home with things waiting", "All quiet" and first-bot states
 * (`SCREENS.home`, `S.earlier` in `vault/Projects/Puck/mockups/Puck prototype.html`).
 *
 * - `home`: banners (lock screen, offline), an urgent alert, a snoozed one, one waiting to send, and
 *   the history over three days, with "Load more" bringing older ones.
 * - `home-clear`: nothing waiting: "All quiet", the flock, and Earlier.
 * - `home-empty`: no bot has paged him yet (H2).
 *
 * Times are relative to the moment a sample is opened; `freshHome` turns them into real times.
 */
import type { BannerId, HistoryItem, WaitingAlert } from "../../../homeModel";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface HomeSample {
  banners: BannerId[];
  waiting: WaitingAlert[];
  /** Waiting alerts whose answer is on the phone (shown "Not sent yet"). */
  queuedIds: string[];
  history: HistoryItem[];
  /** What "Load more" adds. */
  older: HistoryItem[];
  noBots: boolean;
}

export const HOME_SAMPLE_NAMES = ["home", "home-clear", "home-empty"] as const;

export function isHomeSample(name: string): boolean {
  return (HOME_SAMPLE_NAMES as readonly string[]).includes(name);
}

/** The alert was `ago` ms ago at `now`. */
function waiting(
  now: number,
  id: string,
  bot: string,
  question: string,
  ago: number,
  extra: Partial<WaitingAlert> = {},
): WaitingAlert {
  return {
    questionId: `q_HOME${id}`,
    question,
    botId: `home-${bot.toLowerCase()}`,
    botName: bot,
    priority: "normal",
    status: "pending",
    presentation: "choice",
    selectionMode: "single",
    snoozedUntil: null,
    expiresAt: null,
    createdAt: now - ago,
    ...extra,
  };
}

function past(
  now: number,
  id: string,
  bot: string,
  question: string,
  ago: number,
  extra: Partial<HistoryItem> = {},
): HistoryItem {
  const createdAt = now - ago;
  return {
    questionId: `q_HOME${id}`,
    question,
    botName: bot,
    outcome: "answered",
    picks: ["Yes"],
    customReply: null,
    hasAttachments: false,
    answeredAt: createdAt + 2 * MINUTE,
    answeredByClientName: "Pixel 7",
    deliveryStatus: "delivered",
    createdAt,
    ...extra,
  };
}

/** The prototype's `S.earlier`, moved to read the same way whatever time it is now. */
function earlier(now: number): HistoryItem[] {
  return [
    past(now, "H1", "Brow", "Clear out Downloads older than 30 days?", 40 * MINUTE),
    past(now, "H2", "Sheldon", "Merge the onboarding branch?", 70 * MINUTE, {
      picks: ["Merge"],
      customReply: "Squash it, please.",
    }),
    past(now, "H3", "Brow", "Reply to the landlord now?", 100 * MINUTE, { picks: ["Draft it"], deliveryStatus: "failed" }),
    past(now, "H4", "Grok", "Time to get up", 1 * DAY + 3 * HOUR, { picks: ["I'm up"] }),
    past(now, "H5", "Deploy Watch", "Disk at 91% on vault-box", 1 * DAY + 8 * HOUR, {
      outcome: "missed",
      picks: [],
      answeredAt: null,
      deliveryStatus: null,
    }),
  ];
}

function olderOnes(now: number): HistoryItem[] {
  return [
    past(now, "H6", "Sheldon", "Ship the 0.2 build?", 3 * DAY + 2 * HOUR, { picks: ["Ship it"] }),
    past(now, "H7", "Brow", "Archive the old screenshots?", 3 * DAY + 5 * HOUR, {
      outcome: "cancelled",
      picks: [],
      answeredAt: null,
      deliveryStatus: null,
    }),
    past(now, "H8", "Grok", "Time to get up", 9 * DAY, { picks: ["Five more minutes"], deliveryStatus: "pending" }),
  ];
}

/** The named sample with its times moved to `now`; null for an unknown name. */
export function freshHome(name: string, now: number = Date.now()): HomeSample | null {
  switch (name) {
    case "home":
      return {
        banners: ["fullScreen", "offline"],
        waiting: [
          waiting(now, "W1", "Deploy Watch", "Errors up 4x on the checkout service. Roll back?", 3 * MINUTE, {
            priority: "urgent",
          }),
          waiting(now, "W2", "Sheldon", "Ship the 0.3 build tonight?", 12 * MINUTE),
          waiting(now, "W3", "Brow", "Tidy up the old branches?", 40 * MINUTE, {
            status: "snoozed",
            snoozedUntil: now + 10 * MINUTE,
          }),
          waiting(now, "W4", "Grok", "Wake-up call moved to 7:30. Keep it?", 2 * HOUR, { status: "snoozed" }),
          waiting(now, "W5", "Sheldon", "Merge the docs branch?", 5 * MINUTE),
        ],
        queuedIds: ["q_HOMEW5"],
        history: earlier(now),
        older: olderOnes(now),
        noBots: false,
      };
    case "home-clear":
      return { banners: [], waiting: [], queuedIds: [], history: earlier(now), older: olderOnes(now), noBots: false };
    case "home-empty":
      return { banners: [], waiting: [], queuedIds: [], history: [], older: [], noBots: true };
    default:
      return null;
  }
}
