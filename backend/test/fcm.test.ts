import { describe, expect, test } from "bun:test";
import { PUSH_CHANNEL_ID } from "@puck/shared";
import { fcmBody, fcmErrorStatus, fcmMessage, googleAssertionClaims, isPushToken, readServiceAccount } from "../convex/lib/fcm";

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
