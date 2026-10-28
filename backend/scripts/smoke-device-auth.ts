// Live checks against the dev deployment. Reads the setup code from disk.
// Prints pass/fail lines only. Tokens, the setup code, and bot secrets are not printed.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { PENDING_BOT_CAP } from "@puck/shared";

const backend = join(import.meta.dir, "..");
const secrets: string[] = [];

function remember(value: string | undefined) {
  if (value && value.length > 0) secrets.push(value);
}

function safe(message: string): string {
  let out = message;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function readDotEnv(name: string): string {
  const text = readFileSync(join(backend, ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim();
  }
  throw new Error(`missing ${name}`);
}

async function expectFail(label: string, run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = safe(textOf(error));
    if (!pattern.test(message)) {
      console.error(`fail ${label}: ${message}`);
      throw new Error(`${label} failed with an unexpected error`);
    }
    console.log(`pass ${label}`);
    return;
  }
  throw new Error(`${label} succeeded and should have failed`);
}

async function postDevice(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${site}${path}`, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

function clearSmoke(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bun",
      ["x", "convex", "run", "device:clearSmoke", JSON.stringify({ namePrefix: "smokedev" })],
      { cwd: backend, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("close", (code) => {
      const combined = safe(`${out}\n${err}`);
      if (code !== 0) {
        console.error(combined);
        reject(new Error(`clearSmoke exited ${code}`));
        return;
      }
      console.log(`pass clearSmoke ${combined.replace(/\s+/g, " ").trim()}`);
      resolve();
    });
  });
}

const url = readDotEnv("CONVEX_URL");
const site = readDotEnv("CONVEX_SITE_URL");
const setupCode = readFileSync(join(homedir(), ".config", "puck", "device-setup-code"), "utf8").trim();
remember(setupCode);

const anon = new ConvexHttpClient(url);
const pairing = {
  name: "smokedev0",
  webhookUrl: "https://example.com/puck-smoke",
  webhookHeader: "Bearer smoke",
};

let token = "";

try {
  await clearSmoke();

  await expectFail(
    "answers.record with no token",
    () => anon.mutation(api.answers.record, { questionId: "q_smokenotfound01", optionIds: ["yes"] }),
    /unauthorized/,
  );
  await expectFail(
    "approvePairing with no token",
    () => anon.mutation(api.bots.approvePairing, { pairingCode: "000000" }),
    /unauthorized/,
  );
  const opened = await anon.mutation(api.bots.createPairing, pairing);
  remember(opened.secret);
  remember(opened.pairingCode);
  if (!opened.botId) throw new Error("createPairing without a token did not return a bot");
  console.log("pass createPairing with no token creates a pending bot");

  const wrongClaim = await postDevice("/device/claim", { setupCode: "not-the-code" });
  if (wrongClaim.status !== 401 || !wrongClaim.text.includes("setup code is not valid")) {
    throw new Error(`claim with a wrong code: ${wrongClaim.status} ${safe(wrongClaim.text)}`);
  }
  console.log("pass claim with a wrong code");

  const claimed = await postDevice("/device/claim", { setupCode });
  const claimBody = JSON.parse(claimed.text) as { deviceId?: string; secret?: string };
  if (claimed.status !== 200 || !claimBody.deviceId?.startsWith("dev_") || !claimBody.secret) {
    throw new Error(`claim with the setup code: ${claimed.status}`);
  }
  remember(claimBody.secret);
  console.log("pass claim with the setup code");

  const second = await postDevice("/device/claim", { setupCode });
  if (second.status !== 409 || !second.text.includes("a device is already claimed")) {
    throw new Error(`second device claim: ${second.status} ${safe(second.text)}`);
  }
  console.log("pass second device claim");

  const issued = await postDevice("/device/token", undefined, { authorization: `Bearer ${claimBody.secret}` });
  const tokenBody = JSON.parse(issued.text) as { token?: string };
  if (issued.status !== 200 || !tokenBody.token || tokenBody.token.split(".").length !== 3) {
    throw new Error(`token exchange: ${issued.status}`);
  }
  remember(tokenBody.token);
  token = tokenBody.token;
  console.log("pass token exchange");

  const authed = new ConvexHttpClient(url);
  authed.setAuth(token);
  const session = await authed.query(api.device.session, {});
  if (session?.deviceId !== claimBody.deviceId) throw new Error("valid token did not authorize the session query");
  const anonSession = await anon.query(api.device.session, {});
  if (anonSession !== null) throw new Error("session query authorized a caller with no token");
  console.log("pass valid token authorizes device.session");

  await expectFail(
    "valid token authorizes answers.record",
    () => authed.mutation(api.answers.record, { questionId: "q_smokenotfound01", optionIds: ["yes"] }),
    /alert not found/,
  );

  const approved = await authed.mutation(api.bots.approvePairing, { pairingCode: opened.pairingCode });
  if (approved.botId !== opened.botId) throw new Error("approvePairing returned a different bot");
  console.log("pass approvePairing with the token");

  const posted = await fetch(`${site}/alerts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-puck-bot-id": opened.botId,
      authorization: `Bearer ${opened.secret}`,
    },
    body: JSON.stringify({
      question: "Smoke?",
      priority: "normal",
      selectionMode: "single",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    }),
  });
  const postedText = await posted.text();
  if (!posted.ok) throw new Error(`POST /alerts ${posted.status} ${safe(postedText)}`);
  const body = JSON.parse(postedText) as { questionId?: string };
  if (!body.questionId) throw new Error("POST /alerts did not return a question id");
  const recorded = await authed.mutation(api.answers.record, {
    questionId: body.questionId,
    optionIds: ["yes"],
  });
  if (recorded.questionId !== body.questionId) throw new Error("record returned a different question");
  console.log("pass record stores an answer for the paired bot");

  for (let i = 1; i <= PENDING_BOT_CAP; i++) {
    const pending = await anon.mutation(api.bots.createPairing, {
      ...pairing,
      name: `smokedev${i}`,
    });
    remember(pending.secret);
    remember(pending.pairingCode);
  }
  await expectFail(
    "pending bot cap",
    () =>
      anon.mutation(api.bots.createPairing, {
        ...pairing,
        name: "smokedevcap",
      }),
    /too many pending bots/,
  );

  console.log("smoke ok");
} finally {
  await clearSmoke();
}
