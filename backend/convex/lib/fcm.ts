import { DISMISS_KIND, FULL_SCREEN_KIND, PAIRING_KIND, PUSH_CHANNEL_ID } from "@puck/shared";
import { selectPushTargets, type PushTargetClient, type PushTargetDevice } from "./pushTargets";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export interface PushAlert {
  pushToken: string;
  questionId: string;
  question: string;
  botName: string;
  /** The bot's public id (`sheldon-11019`), so the phone can apply that bot's own settings. Full-screen message only. */
  botId?: string;
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
  "message" | "botId" | "ringSeconds" | "speak" | "bypassDnd" | "bypassSilent" | "requiresUnlock"
> {
  const record = isRecord(source) ? source : {};
  const extras: ReturnType<typeof pushAlertExtras> = {};
  if (typeof record.message === "string") extras.message = record.message;
  if (typeof record.botId === "string" && record.botId.length > 0) extras.botId = record.botId;
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
  // Additive: an older phone app ignores the key. The phone looks up this bot's own Do Not Disturb
  // and silent-mode overrides with it (`bypassDecision`).
  if (alert.botId !== undefined) data.botId = alert.botId;
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

/**
 * Data-only pairing request (N7). The phone draws its own notification and opens the approve
 * screen from `botId`; the pairing code is not in the push, the phone reads it from the app's
 * pending pairing requests.
 */
export function fcmPairingMessage(input: {
  pushToken: string;
  botId: string;
  botName: string;
  colour: string | null;
  addedFrom: string | null;
}) {
  const data: Record<string, string> = {
    kind: PAIRING_KIND,
    botId: input.botId,
    botName: input.botName,
  };
  if (input.colour !== null) data.colour = input.colour;
  if (input.addedFrom !== null) data.addedFrom = input.addedFrom;
  return {
    message: {
      token: input.pushToken,
      data,
      android: {
        priority: "HIGH" as const,
      },
    },
  };
}

/**
 * Data-only message that tells a phone to drop an alert (answered or snoozed on another client).
 * The phone's background task removes the shade and lock-screen copy. No `notification` block,
 * so nothing is drawn. Keys: `kind` and `questionId`, the same names the other data pushes use.
 */
export function fcmDismissMessage(input: { pushToken: string; questionId: string }) {
  return {
    message: {
      token: input.pushToken,
      data: { kind: DISMISS_KIND, questionId: input.questionId },
      android: {
        priority: "HIGH" as const,
      },
    },
  };
}

/**
 * Push tokens that should drop an alert: every client with a token, plus the legacy device, except
 * whoever acted on it. `exceptClientId` is the client that answered; with null the legacy device
 * answered, so its token is the one left out. A token shared with the acting client is left out too.
 */
export function selectDismissTargets(input: {
  clients: readonly PushTargetClient[];
  device: PushTargetDevice | null;
  exceptClientId: string | null;
}): string[] {
  const skip = new Set<string>();
  if (input.exceptClientId === null) {
    if (input.device?.pushToken) skip.add(input.device.pushToken);
  } else {
    for (const client of input.clients) {
      if (client.id === input.exceptClientId && client.pushToken) skip.add(client.pushToken);
    }
  }
  return selectPushTargets({ clients: input.clients, device: input.device })
    .map((target) => target.pushToken)
    .filter((token) => !skip.has(token));
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
