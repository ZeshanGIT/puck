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
  fcmLiveMessage,
  fcmPairingMessage,
  pushAlertExtras,
  readServiceAccount,
  retryDelay,
  isUnregisteredToken,
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

/** Schedule independent deliveries so a slow target does not delay the others. */
export const send = internalActionGeneric({
  args: { alertId: v.id("alerts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.alerts.loadForPush, args);
    if (!target.send) return null;
    await Promise.all(target.targets.map((entry) => ctx.scheduler.runAfter(0, internal.push.sendTarget, {
      alertId: args.alertId, pushToken: entry.pushToken, generation: target.pushGeneration,
      deadline: target.pushExpiresAt, attempt: 0,
    })));
    return null;
  },
});

export const sendTarget = internalActionGeneric({
  args: { alertId: v.id("alerts"), pushToken: v.string(), generation: v.number(), deadline: v.number(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.alerts.loadForPush, { alertId: args.alertId });
    const entry = target.send ? target.targets.find((item) => item.pushToken === args.pushToken) : undefined;
    if (!target.send || !entry || target.pushGeneration !== args.generation || Date.now() >= args.deadline) return null;
    const raw = readEnv("FIREBASE_SERVICE_ACCOUNT");
    if (!raw) { console.log("push skipped: firebase is not configured"); return null; }
    let status = 503;
    let retryAfter: string | null = null;
    try {
      const account = readServiceAccount(raw);
      const accessToken = await googleAccessToken(account.clientEmail, account.privateKey);
      // OAuth may take long enough for the alert to have been resolved.
      const current = await ctx.runQuery(internal.alerts.loadForPush, { alertId: args.alertId });
      if (!current.send || current.pushGeneration !== args.generation || !current.targets.some((item) => item.pushToken === args.pushToken) || Date.now() >= args.deadline) return null;
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
        method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(fcmBody({ pushToken: entry.pushToken, questionId: current.questionId,
          question: current.question, botName: current.botName, priority: current.priority,
          fullScreen: entry.fullScreenAllowed, ttlSeconds: Math.max(0, Math.floor((args.deadline - Date.now()) / 1000)),
          ...pushAlertExtras(current) })), signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return null;
      status = response.status;
      retryAfter = response.headers.get("retry-after");
      const body = await response.text();
      console.log(`push failed: ${isUnregisteredToken(body) ? "unregistered token" : fcmErrorStatus(body)}`);
    } catch { console.log("push failed: request"); }
    const delay = retryDelay(status, retryAfter, args.attempt, Date.now());
    if (delay !== null && Date.now() + delay < args.deadline) {
      await ctx.scheduler.runAfter(delay, internal.push.sendTarget, { ...args, attempt: args.attempt + 1 });
    }
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

/**
 * Sends a live-activity update (N8) to the owner's clients: one data-only FCM message each. Same
 * failure handling as the other pushes: logged without the service account or tokens, not retried.
 */
export const sendLive = internalActionGeneric({
  args: { activityId: v.id("liveActivities") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.live.loadPush, { activityId: args.activityId });
    if (!target.send) {
      console.log(`live push skipped: ${target.reason}`);
      return null;
    }
    const raw = readEnv("FIREBASE_SERVICE_ACCOUNT");
    if (!raw) {
      console.log("live push skipped: firebase is not configured");
      return null;
    }
    let account;
    let accessToken;
    try {
      account = readServiceAccount(raw);
      accessToken = await googleAccessToken(account.clientEmail, account.privateKey);
    } catch {
      console.log("live push failed: request");
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
            fcmLiveMessage({
              pushToken: entry.pushToken,
              activityId: target.activityId,
              botId: target.botId,
              botName: target.botName,
              colour: target.colour,
              title: target.title,
              currentStep: target.currentStep,
              state: target.state,
              stepIndex: target.stepIndex,
              stepCount: target.stepCount,
              startedAt: target.startedAt,
              updatedAt: target.updatedAt,
            }),
          ),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) sent += 1;
        else console.log(`live push failed: ${fcmErrorStatus(await response.text())}`);
      } catch {
        console.log("live push failed: request");
      }
    }
    console.log(pushSummary(sent, target.targets.length));
    return null;
  },
});
