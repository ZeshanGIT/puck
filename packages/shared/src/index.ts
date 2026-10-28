// Types shared by the Convex backend, the Expo app and the puck CLI.
// Plain TypeScript with no runtime dependencies, so every workspace can import it.

/** An alert can offer at most this many tap-to-reply options. */
export const MAX_OPTIONS = 4;

/** Lifecycle of an alert, from creation to its final state. */
export const ALERT_STATUSES = [
  "scheduled", // waiting for scheduledFor
  "pending", // saved, push not yet confirmed
  "delivered", // push sent to the phone
  "answered", // Seshan replied
  "dismissed", // dismissed on the phone without a reply
  "cancelled", // cancelled by the agent (puck cancel)
  "expired", // nobody replied before the timeout
] as const;

export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** How an alert was answered: one of its options, or free text. */
export type Reply =
  | { kind: "option"; option: string; repliedAt: number }
  | { kind: "text"; text: string; repliedAt: number };

/** An alert as returned by the API (timestamps are Unix epoch milliseconds). */
export interface Alert {
  id: string;
  agentId: string;
  message: string;
  options: string[];
  allowText: boolean;
  status: AlertStatus;
  scheduledFor?: number;
  webhookUrl?: string;
  reply?: Reply;
  createdAt: number;
  updatedAt: number;
}

/** Body for creating an alert (puck send / ask / schedule). */
export interface CreateAlertRequest {
  message: string;
  /** Up to MAX_OPTIONS options. Empty for a one-way alert (puck send). */
  options?: string[];
  /** Whether the phone shows a free-text reply box. */
  allowText?: boolean;
  /** Ring at this time (epoch ms) instead of now (puck schedule). */
  scheduledFor?: number;
  /** POST the reply here instead of waiting for it (puck ask --webhook). */
  webhookUrl?: string;
}

export interface CreateAlertResponse {
  alert: Alert;
}

export interface ListAlertsResponse {
  alerts: Alert[];
}

/** Environment variable holding an agent's API key. */
export const PUCK_KEY_ENV = "PUCK_KEY";
