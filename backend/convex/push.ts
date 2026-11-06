"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { importPKCS8, SignJWT } from "jose";
import { internal } from "./_generated/api";
import { pushSummary } from "./lib/pushTargets";
import {
  fcmBody,
  fcmDismissMessage,
  fcmErrorStatus,
  fcmPairingMessage,
  pushAlertExtras,
  readServiceAccount,
} from "./lib/fcm";

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
              // The ring length, spoken text and bypass flags, when `loadForPush` returns them.
              ...pushAlertExtras(target),
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

/**
 * Tells every client except the one that acted to drop an alert (answered or snoozed elsewhere,
 * A9). A data-only push, `{kind: "dismiss", questionId}`; the phone removes its shade and
 * lock-screen copy. Best effort: failures are logged without tokens and never retried.
 */
export const sendDismiss = internalActionGeneric({
  args: { questionId: v.string(), exceptClientId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokens = await ctx.runQuery(internal.alerts.loadDismissTargets, {
      ...(args.exceptClientId === undefined ? {} : { exceptClientId: args.exceptClientId }),
    });
    if (tokens.length === 0) return null;
    const raw = readEnv("FIREBASE_SERVICE_ACCOUNT");
    if (!raw) {
      console.log("dismiss skipped: firebase is not configured");
      return null;
    }
    let account;
    let accessToken;
    try {
      account = readServiceAccount(raw);
      accessToken = await googleAccessToken(account.clientEmail, account.privateKey);
    } catch {
      console.log("dismiss failed: request");
      return null;
    }
    const url = `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`;
    let sent = 0;
    for (const pushToken of tokens) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(fcmDismissMessage({ pushToken, questionId: args.questionId })),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) sent += 1;
        else console.log(`dismiss failed: ${fcmErrorStatus(await response.text())}`);
      } catch {
        console.log("dismiss failed: request");
      }
    }
    console.log(`dismiss ${pushSummary(sent, tokens.length)}`);
    return null;
  },
});

/**
 * Sends the pairing request (N7) to the signed-in owner's clients: one data-only FCM message each.
 * Same failure handling as `send`: logged without the service account or tokens, never retried.
 */
export const sendPairing = internalActionGeneric({
  args: { botDocId: v.id("bots") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.bots.loadPairingPush, { botDocId: args.botDocId });
    if (!target.send) {
      console.log(`pairing push skipped: ${target.reason}`);
      return null;
    }
    const raw = readEnv("FIREBASE_SERVICE_ACCOUNT");
    if (!raw) {
      console.log("pairing push skipped: firebase is not configured");
      return null;
    }
    let account;
    let accessToken;
    try {
      account = readServiceAccount(raw);
      accessToken = await googleAccessToken(account.clientEmail, account.privateKey);
    } catch {
      console.log("pairing push failed: request");
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
            fcmPairingMessage({
              pushToken: entry.pushToken,
              botId: target.botId,
              botName: target.botName,
              colour: target.colour,
              addedFrom: target.addedFrom,
            }),
          ),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) sent += 1;
        else console.log(`pairing push failed: ${fcmErrorStatus(await response.text())}`);
      } catch {
        console.log("pairing push failed: request");
      }
    }
    console.log(pushSummary(sent, target.targets.length));
    return null;
  },
});
