import { FULL_SCREEN_KIND, PUSH_CHANNEL_ID } from "@puck/shared";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export interface PushAlert {
  pushToken: string;
  questionId: string;
  question: string;
  botName: string;
  priority: "normal" | "urgent";
  fullScreen: boolean;
  /** The alert's own fields (Protocol changes section 1). Only the full-screen message carries them. */
  message?: string;
  ringSeconds?: number;
  speak?: boolean;
  bypassDnd?: boolean;
  bypassSilent?: boolean;
  requiresUnlock?: boolean;
}

/** The longest message text sent in a push, the same as `message` on `POST /alerts`. */
const PUSH_MESSAGE_MAX = 1_000;

/**
 * Picks the optional alert fields out of whatever the push query returned, so an older query
 * that does not return them still works. Wrong types are dropped, never thrown on.
 */
export function pushAlertExtras(source: unknown): Pick<
  PushAlert,
  "message" | "ringSeconds" | "speak" | "bypassDnd" | "bypassSilent" | "requiresUnlock"
> {
  const record = isRecord(source) ? source : {};
  const extras: ReturnType<typeof pushAlertExtras> = {};
  if (typeof record.message === "string") extras.message = record.message;
  if (typeof record.ringSeconds === "number") extras.ringSeconds = record.ringSeconds;
  for (const flag of ["speak", "bypassDnd", "bypassSilent", "requiresUnlock"] as const) {
    const value = record[flag];
    if (typeof value === "boolean") extras[flag] = value;
  }
  return extras;
}

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** FCM registration tokens are long printable strings. Reject anything that could break a log line. */
export function isPushToken(token: string): boolean {
  return token.length >= 20 && token.length <= 4096 && !/[\s"'\\]/.test(token);
}

/**
 * Notification message for a backgrounded phone.
 * The system draws the heads-up. The question id is how a tap finds the alert.
 */
/** Shade notification. Urgent alerts use this until full-screen access is allowed. */
export function fcmMessage(alert: PushAlert) {
  return {
    message: {
      token: alert.pushToken,
      notification: {
        title: alert.botName,
        body: alert.question,
      },
      data: {
        questionId: alert.questionId,
      },
      android: {
        priority: "HIGH" as const,
        notification: {
          channel_id: PUSH_CHANNEL_ID,
          notification_priority: "PRIORITY_MAX" as const,
          visibility: "PUBLIC" as const,
          tag: alert.questionId,
        },
      },
    },
  };
}

/**
 * Data-only message. The phone's background task draws it, so a lock screen can be covered.
 * Keys that Expo would turn into its own notification (`title`, `message`, `body`) stay unused.
 */
export function fcmFullScreenMessage(alert: PushAlert) {
  // FCM data values are strings. A field the alert does not set is left out, so the phone
  // applies its own defaults, and an older phone app ignores the keys it does not know.
  const data: Record<string, string> = {
    kind: FULL_SCREEN_KIND,
    questionId: alert.questionId,
    question: alert.question,
    botName: alert.botName,
    priority: alert.priority,
  };
  if (alert.ringSeconds !== undefined) data.ringSeconds = String(alert.ringSeconds);
  if (alert.speak !== undefined) data.speak = String(alert.speak);
  if (alert.bypassDnd !== undefined) data.bypassDnd = String(alert.bypassDnd);
  if (alert.bypassSilent !== undefined) data.bypassSilent = String(alert.bypassSilent);
  if (alert.requiresUnlock !== undefined) data.requiresUnlock = String(alert.requiresUnlock);
  // Only a spoken alert needs its message on the phone before the app opens. The key is not
  // `message`, which Expo would turn into its own notification text.
  if (alert.speak === true && alert.message) data.alertMessage = alert.message.slice(0, PUSH_MESSAGE_MAX);
  return {
    message: {
      token: alert.pushToken,
      data,
      android: {
        priority: "HIGH" as const,
      },
    },
  };
}

export function fcmBody(alert: PushAlert) {
  if (alert.priority === "urgent" && alert.fullScreen) return fcmFullScreenMessage(alert);
  return fcmMessage(alert);
}

/** Google's OAuth error responses can echo the device token. Keep the status code only. */
export function fcmErrorStatus(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown } };
    const status = parsed.error?.status;
    if (typeof status === "string" && /^[A-Z_]{3,40}$/.test(status)) return status;
  } catch {
    // Not JSON. Do not return the body.
  }
  return "HTTP error";
}

export function readServiceAccount(raw: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("firebase service account is not valid");
  }
  if (!isRecord(parsed)) throw new Error("firebase service account is not valid");
  const projectId = parsed.project_id;
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{4,60}$/.test(projectId)) {
    throw new Error("firebase service account is not valid");
  }
  if (typeof clientEmail !== "string" || !clientEmail.endsWith(".iam.gserviceaccount.com")) {
    throw new Error("firebase service account is not valid");
  }
  if (typeof privateKey !== "string" || !privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("firebase service account is not valid");
  }
  return { projectId, clientEmail, privateKey };
}

export function googleAssertionClaims(clientEmail: string, nowSeconds: number) {
  return {
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
