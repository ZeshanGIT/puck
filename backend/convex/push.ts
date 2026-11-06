"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { importPKCS8, SignJWT } from "jose";
import { internal } from "./_generated/api";
import { pushSummary } from "./lib/pushTargets";
import { fcmBody, fcmErrorStatus, readServiceAccount } from "./lib/fcm";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function readEnv(name: string): string | undefined {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.[name];
}

async function googleAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const key = await importPKCS8(privateKey, "RS256");
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("google rejected the service account");
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error("google rejected the service account");
  }
  return body.access_token;
}

/**
 * Sends the heads-up for a pending alert to every target, one FCM message each.
 * Failures are logged without the service account or any device token, and one failing
 * target does not stop the others. The alert stays pending so the open app can still show it.
 */
export const send = internalActionGeneric({
  args: { alertId: v.id("alerts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.alerts.loadForPush, { alertId: args.alertId });
    if (!target.send) {
      console.log(`push skipped: ${target.reason}`);
      return null;
    }
    const raw = readEnv("FIREBASE_SERVICE_ACCOUNT");
    if (!raw) {
      console.log("push skipped: firebase is not configured");
      return null;
    }
    let account;
    let accessToken;
    try {
      account = readServiceAccount(raw);
      accessToken = await googleAccessToken(account.clientEmail, account.privateKey);
    } catch {
      console.log("push failed: request");
      return null;
    }
    const url = `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`;
    let sent = 0;
    for (const entry of target.targets) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            fcmBody({
              pushToken: entry.pushToken,
              questionId: target.questionId,
              question: target.question,
              botName: target.botName,
              priority: target.priority,
              fullScreen: entry.fullScreenAllowed,
            }),
          ),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) sent += 1;
        else console.log(`push failed: ${fcmErrorStatus(await response.text())}`);
      } catch {
        console.log("push failed: request");
      }
    }
    console.log(pushSummary(sent, target.targets.length));
    return null;
  },
});
