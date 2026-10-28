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
  await expectFail(
    "createPairing with no token",
    () => anon.mutation(api.bots.createPairing, pairing),
    /unauthorized/,
  );
  await expectFail(
    "claim with a wrong code",
    () => anon.mutation(api.device.claim, { setupCode: "not-the-code" }),
    /setup code is not valid/,
  );

  const claimed = await anon.mutation(api.device.claim, { setupCode });
  remember(claimed.token);
  if (!claimed.deviceId.startsWith("dev_") || claimed.token.split(".").length !== 3) {
    throw new Error("claim did not return a device jwt");
  }
  token = claimed.token;
  console.log("pass claim with the setup code");

  await expectFail(
    "second device claim",
    () => anon.mutation(api.device.claim, { setupCode }),
    /a device is already claimed/,
  );

  const authed = new ConvexHttpClient(url);
  authed.setAuth(token);
  await expectFail(
    "valid token authorizes answers.record",
    () => authed.mutation(api.answers.record, { questionId: "q_smokenotfound01", optionIds: ["yes"] }),
    /alert not found/,
  );

  const created = await authed.mutation(api.bots.createPairing, pairing);
  remember(created.secret);
  remember(created.pairingCode);
  const approved = await authed.mutation(api.bots.approvePairing, { pairingCode: created.pairingCode });
  if (approved.botId !== created.botId) throw new Error("approvePairing returned a different bot");
  console.log("pass createPairing and approvePairing with the token");

  const posted = await fetch(`${site}/alerts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-puck-bot-id": created.botId,
      authorization: `Bearer ${created.secret}`,
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
    const pending = await authed.mutation(api.bots.createPairing, {
      ...pairing,
      name: `smokedev${i}`,
    });
    remember(pending.secret);
    remember(pending.pairingCode);
  }
  await expectFail(
    "pending bot cap",
    () =>
      authed.mutation(api.bots.createPairing, {
        ...pairing,
        name: "smokedevcap",
      }),
    /too many pending bots/,
  );

  console.log("smoke ok");
} finally {
  await clearSmoke();
}
