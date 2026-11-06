import { describe, expect, test } from "bun:test";
import { DISMISS_KIND, PUSH_CHANNEL_ID } from "@puck/shared";
import {
  fcmBody,
  fcmDismissMessage,
  selectDismissTargets,
  fcmErrorStatus,
  fcmMessage,
  googleAssertionClaims,
  isPushToken,
  pushAlertExtras,
  readServiceAccount,
} from "../convex/lib/fcm";

const TOKEN = "fcm-token-value-0123456789";

describe("fcmMessage", () => {
  test("is a high-priority notification that names the question", () => {
    const message = fcmMessage({
      pushToken: TOKEN,
      questionId: "q_BEXA0M8Y5W1ADYPX",
      question: "Ship it?",
      botName: "test",
      priority: "normal",
      fullScreen: false,
    });
    expect(message.message.notification).toEqual({ title: "test", body: "Ship it?" });
    expect(message.message.data.questionId).toBe("q_BEXA0M8Y5W1ADYPX");
    expect(message.message.android.priority).toBe("HIGH");
    expect(message.message.android.notification.channel_id).toBe(PUSH_CHANNEL_ID);
    expect(message.message.android.notification.notification_priority).toBe("PRIORITY_MAX");
    expect(JSON.stringify(message)).not.toContain("private_key");
  });

  test("an urgent alert with full-screen access is data-only", () => {
    const message = fcmBody({
      pushToken: TOKEN,
      questionId: "q_BEXA0M8Y5W1ADYPX",
      question: "Lock screen?",
      botName: "test",
      priority: "urgent",
      fullScreen: true,
    });
    expect("notification" in message.message).toBe(false);
    expect(message.message.data?.kind).toBe("fullscreen");
    expect(message.message.data?.title).toBeUndefined();
    expect(message.message.android.priority).toBe("HIGH");
  });

  test("an urgent alert without full-screen access stays a shade notification", () => {
    const message = fcmBody({
      pushToken: TOKEN,
      questionId: "q_BEXA0M8Y5W1ADYPX",
      question: "Lock screen?",
      botName: "test",
      priority: "urgent",
      fullScreen: false,
    });
    expect(message.message.notification?.body).toBe("Lock screen?");
  });
});

describe("fcmErrorStatus", () => {
  test("keeps the status and drops a body that contains the token", () => {
    const body = JSON.stringify({
      error: { status: "UNREGISTERED", message: `The token ${TOKEN} is not registered` },
    });
    expect(fcmErrorStatus(body)).toBe("UNREGISTERED");
    expect(fcmErrorStatus(`raw ${TOKEN}`)).toBe("HTTP error");
    expect(fcmErrorStatus(`raw ${TOKEN}`)).not.toContain(TOKEN);
  });
});

describe("readServiceAccount", () => {
  test("reads the project and rejects a file with no key", () => {
    const account = readServiceAccount(
      JSON.stringify({
        project_id: "puck-d13be",
        client_email: "push@puck-d13be.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nnot-real\n-----END PRIVATE KEY-----\n",
      }),
    );
    expect(account.projectId).toBe("puck-d13be");
    expect(account.clientEmail.endsWith(".iam.gserviceaccount.com")).toBe(true);
    expect(() => readServiceAccount("{}")).toThrow("firebase service account is not valid");
  });
});

describe("googleAssertionClaims", () => {
  test("asks only for Firebase messaging", () => {
    const claims = googleAssertionClaims("push@puck-d13be.iam.gserviceaccount.com", 1_700_000_000);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.exp - claims.iat).toBe(3600);
    expect(JSON.stringify(claims)).not.toContain("PRIVATE KEY");
  });
});

describe("isPushToken", () => {
  test("rejects short values and anything with a space", () => {
    expect(isPushToken(TOKEN)).toBe(true);
    expect(isPushToken("short")).toBe(false);
    expect(isPushToken(`${TOKEN} stolen`)).toBe(false);
  });
});

describe("full-screen message flags", () => {
  const base = {
    pushToken: TOKEN,
    questionId: "q_BEXA0M8Y5W1ADYPX",
    question: "Time to get up",
    botName: "Grok Bot",
    priority: "urgent" as const,
    fullScreen: true,
  };

  test("carries the ring length and flags as strings, and the message only when it is spoken", () => {
    const message = fcmBody({
      ...base,
      message: "Flight at **10:40**",
      ringSeconds: 300,
      speak: true,
      bypassDnd: true,
      bypassSilent: false,
      requiresUnlock: false,
    });
    expect(message.message.data).toEqual({
      kind: "fullscreen",
      questionId: base.questionId,
      question: base.question,
      botName: "Grok Bot",
      priority: "urgent",
      ringSeconds: "300",
      speak: "true",
      bypassDnd: "true",
      bypassSilent: "false",
      requiresUnlock: "false",
      alertMessage: "Flight at **10:40**",
    });
  });

  test("leaves out what the alert does not set, and the message when it is not spoken", () => {
    const quiet = fcmBody({ ...base, message: "Private details", speak: false });
    expect(quiet.message.data).toEqual({
      kind: "fullscreen",
      questionId: base.questionId,
      question: base.question,
      botName: "Grok Bot",
      priority: "urgent",
      speak: "false",
    });
    expect(JSON.stringify(fcmBody(base))).not.toContain("alertMessage");
  });

  test("cuts a long spoken message to the message limit", () => {
    const message = fcmBody({ ...base, speak: true, message: "x".repeat(5000) });
    expect(message.message.data?.alertMessage?.length).toBe(1000);
  });

  test("a shade notification ignores the new fields", () => {
    const message = fcmBody({ ...base, fullScreen: false, speak: true, message: "hi", ringSeconds: 60 });
    expect(message.message.notification?.body).toBe("Time to get up");
    expect(message.message.data?.alertMessage).toBeUndefined();
  });
});

describe("pushAlertExtras", () => {
  test("picks the optional fields and drops wrong types", () => {
    expect(
      pushAlertExtras({
        message: "m",
        ringSeconds: 60,
        speak: true,
        bypassDnd: "yes",
        requiresUnlock: false,
        other: 1,
      }),
    ).toEqual({ message: "m", ringSeconds: 60, speak: true, requiresUnlock: false });
    expect(pushAlertExtras({})).toEqual({});
    expect(pushAlertExtras(null)).toEqual({});
  });
});

describe("fcmDismissMessage", () => {
  test("is a data-only, high-priority message with string values", () => {
    const message = fcmDismissMessage({ pushToken: TOKEN, questionId: "q_BEXA0M8Y5W1ADYPX" });
    expect(message.message.token).toBe(TOKEN);
    expect(message.message.data).toEqual({ kind: DISMISS_KIND, questionId: "q_BEXA0M8Y5W1ADYPX" });
    expect(message.message.android.priority).toBe("HIGH");
    expect("notification" in message.message).toBe(false);
    expect(Object.values(message.message.data).every((value) => typeof value === "string")).toBe(true);
  });
});

describe("selectDismissTargets", () => {
  const clients = [
    { id: "c1", pushToken: "token-for-client-one-0001", fullScreenAllowed: true },
    { id: "c2", pushToken: "token-for-client-two-0002", fullScreenAllowed: false },
    { id: "c3", pushToken: null },
  ];
  const device = { pushToken: "token-for-the-old-device-3" };

  test("leaves out the client that answered and keeps the others and the legacy device", () => {
    expect(selectDismissTargets({ clients, device, exceptClientId: "c1" })).toEqual([
      "token-for-client-two-0002",
      "token-for-the-old-device-3",
    ]);
  });

  test("an answer from the legacy device leaves out only its token", () => {
    expect(selectDismissTargets({ clients, device, exceptClientId: null })).toEqual([
      "token-for-client-one-0001",
      "token-for-client-two-0002",
    ]);
  });

  test("a legacy device sharing the answering client's token is not pushed", () => {
    const shared = { pushToken: "token-for-client-one-0001" };
    expect(selectDismissTargets({ clients, device: shared, exceptClientId: "c1" })).toEqual([
      "token-for-client-two-0002",
    ]);
  });

  test("nobody else means no targets", () => {
    expect(selectDismissTargets({ clients: [clients[0]!], device: null, exceptClientId: "c1" })).toEqual([]);
  });
});
