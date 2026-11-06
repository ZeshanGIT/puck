import { FULL_SCREEN_KIND, PUSH_CHANNEL_ID } from "@puck/shared";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export interface PushAlert {
  pushToken: string;
  questionId: string;
  question: string;
  botName: string;
  priority: "normal" | "urgent";
  fullScreen: boolean;
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
  return {
    message: {
      token: alert.pushToken,
      data: {
        kind: FULL_SCREEN_KIND,
        questionId: alert.questionId,
        question: alert.question,
        botName: alert.botName,
        priority: alert.priority,
      },
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
