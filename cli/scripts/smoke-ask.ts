// Live CLI loop against the dev deployment.
// Prints pass/fail lines only. The setup code, device secret, JWT, and bot secret are not printed.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server";
import { buildAnswerPayload, isQuestionId } from "@puck/shared";

const repo = join(import.meta.dir, "../..");
const backend = join(repo, "backend");
const cli = join(repo, "cli/src/index.ts");
const configDir = join(homedir(), ".config", "puck");
const botName = "smokedevask";
const webhookHeader = "Bearer smoke";
const secrets: string[] = [];

function remember(value: string | undefined): void {
  if (value && value.length >= 8) secrets.push(value);
}

function safe(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

function readDotEnv(name: string): string {
  const text = readFileSync(join(backend, ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim();
  }
  throw new Error(`missing ${name}`);
}

const deploymentUrl = readDotEnv("CONVEX_URL");
const siteUrl = new URL(deploymentUrl).origin.replace(/\.convex\.cloud$/u, ".convex.site");
remember(webhookHeader);

function mutation(name: "approvePairing" | "record" | "createPairing"): FunctionReference<"mutation"> {
  const ref = name === "approvePairing" ? anyApi.bots?.approvePairing : name === "record" ? anyApi.answers?.record : anyApi.bots?.createPairing;
  if (!ref) throw new Error("convex client is missing a mutation");
  return ref as FunctionReference<"mutation">;
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function puck(args: string[], extra: NodeJS.ProcessEnv = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return run(process.execPath, [cli, ...args], repo, {
    ...process.env,
    PUCK_DEPLOYMENT_URL: deploymentUrl,
    ...extra,
  });
}

async function inlineQuery(source: string): Promise<Record<string, unknown>> {
  const result = await run(process.execPath, ["x", "convex", "run", "--inline-query", source], backend, process.env);
  if (result.code !== 0) throw new Error(`inline query exited ${result.code}: ${safe(result.stderr)}`);
  const start = result.stdout.indexOf("{");
  const end = result.stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("inline query did not return JSON");
  const parsed: unknown = JSON.parse(result.stdout.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null) throw new Error("inline query did not return an object");
  return parsed as Record<string, unknown>;
}

async function clearSmoke(): Promise<void> {
  const result = await run(
    process.execPath,
    ["x", "convex", "run", "device:clearSmoke", JSON.stringify({ namePrefix: botName })],
    backend,
    process.env,
  );
  if (result.code !== 0) throw new Error(`clearSmoke exited ${result.code}: ${safe(result.stderr)}`);
  console.log(`pass clearSmoke ${safe(result.stdout).replace(/\s+/gu, " ").trim()}`);
}

async function postDevice(path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; text: string }> {
  const response = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

async function ensureDeploymentConfig(): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, "config.json");
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch {
    current = {};
  }
  if (typeof current.deploymentUrl === "string" && current.deploymentUrl.trim()) return;
  current.deploymentUrl = deploymentUrl;
  await writeFile(path, `${JSON.stringify({ deploymentUrl: current.deploymentUrl }, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

let botId = "";

try {
  await clearSmoke();
  await ensureDeploymentConfig();
  const setupCode = (await readFile(join(configDir, "device-setup-code"), "utf8")).trim();
  remember(setupCode);

  const added = await puck(["add", botName], {
    PUCK_WEBHOOK_URL: "https://httpbin.org/post",
    PUCK_WEBHOOK_HEADER: webhookHeader,
  });
  const code = /^code: (\d{6})$/mu.exec(added.stdout)?.[1];
  botId = /^bot: (\S+)$/mu.exec(added.stdout)?.[1] ?? "";
  if (added.code !== 0 || !code || !botId.startsWith(`${botName}-`)) {
    throw new Error(`puck add failed (${added.code}) ${safe(added.stderr)}`);
  }
  const secret = (await readFile(join(configDir, `${botId}.key`), "utf8")).trim();
  remember(secret);
  const shown = `${added.stdout}\n${added.stderr}`;
  if (shown.includes(secret) || shown.includes(webhookHeader) || shown.includes(setupCode)) {
    throw new Error("puck add printed a secret");
  }
  const mode = (await stat(join(configDir, `${botId}.key`))).mode & 0o777;
  if (mode !== 0o600) throw new Error(`key mode is ${mode.toString(8)}`);
  console.log("pass puck add wrote the key and printed the code");

  const claimed = await postDevice("/device/claim", { setupCode });
  const claimBody = JSON.parse(claimed.text) as { deviceId?: string; secret?: string };
  remember(claimBody.secret);
  if (claimed.status !== 200 || !claimBody.secret) throw new Error(`device claim failed (${claimed.status})`);
  const issued = await postDevice("/device/token", undefined, { authorization: `Bearer ${claimBody.secret}` });
  const token = (JSON.parse(issued.text) as { token?: string }).token;
  remember(token);
  if (issued.status !== 200 || !token) throw new Error(`token exchange failed (${issued.status})`);
  console.log("pass device claim");

  const authed = new ConvexHttpClient(deploymentUrl);
  authed.setAuth(token);
  const approved = (await authed.mutation(mutation("approvePairing"), { pairingCode: code })) as { botId?: string };
  if (approved.botId !== botId) throw new Error("approvePairing returned a different bot");
  console.log("pass approvePairing");

  const asked = await puck(["ask", "Up yet?", "--options", "Yes,No", "--priority", "normal", "--bot", botId]);
  const questionId = asked.stdout.trim();
  if (asked.code !== 0 || !isQuestionId(questionId)) throw new Error(`puck ask failed (${asked.code}) ${safe(asked.stderr)}`);
  if (`${asked.stdout}\n${asked.stderr}`.includes(secret)) throw new Error("puck ask printed the bot secret");
  console.log("pass puck ask returned a question id");

  await authed.mutation(mutation("record"), { questionId, optionIds: ["yes"] });
  let delivered = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${siteUrl}/alerts/${questionId}`, {
      headers: { "x-puck-bot-id": botId, authorization: `Bearer ${secret}` },
    });
    const body = (await response.json()) as {
      question?: string;
      priority?: string;
      options?: { id: string; label: string }[];
      answer?: { answers?: { id: string; label: string }[]; customReply?: string | null; source?: string; deliveryStatus?: string; lastError?: string | null };
    };
    if (body.answer?.deliveryStatus === "failed") {
      throw new Error(`delivery failed ${safe(body.answer.lastError ?? "")}`);
    }
    if (body.answer?.deliveryStatus === "delivered") {
      if (body.question !== "Up yet?" || body.priority !== "normal") throw new Error("stored alert does not match the ask");
      if (body.answer.answers?.[0]?.id !== "yes" || body.answer.answers[0]?.label !== "Yes") {
        throw new Error("option id was not stable");
      }
      delivered = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!delivered) throw new Error("delivery did not reach delivered");
  const stored = await inlineQuery(`
    const bot = (await ctx.db.query("bots").take(20)).find((row) => row.id === ${JSON.stringify(botId)});
    const alert = bot ? (await ctx.db.query("alerts").take(20)).find((row) => row.botId === bot._id) : null;
    const answer = alert ? (await ctx.db.query("answers").take(20)).find((row) => row.alertId === alert._id) : null;
    if (!bot || !alert || !answer) return { found: false };
    return {
      found: true,
      bot: bot.name,
      routine: bot.routine,
      questionId: alert.questionId,
      question: alert.question,
      priority: alert.priority,
      answers: answer.answers,
      customReply: answer.customReply,
      source: answer.source,
      answeredAt: answer.answeredAt,
      deliveryStatus: answer.deliveryStatus,
    };
  `);
  const answeredAt = stored.answeredAt;
  const answers = stored.answers;
  if (!stored.found || stored.deliveryStatus !== "delivered" || typeof answeredAt !== "number" || !Array.isArray(answers)) {
    throw new Error("stored answer was not delivered");
  }
  const payload = buildAnswerPayload({
    questionId: String(stored.questionId),
    question: String(stored.question),
    bot: String(stored.bot),
    routine: String(stored.routine),
    priority: stored.priority === "urgent" ? "urgent" : "normal",
    answers: answers as { id: string; label: string }[],
    customReply: stored.customReply === null ? null : String(stored.customReply ?? ""),
    answeredAt,
    source: "app",
  });
  if (
    payload.bot !== botName ||
    payload.routine !== botName ||
    payload.question !== "Up yet?" ||
    payload.priority !== "normal" ||
    payload.customReply !== null ||
    payload.source !== "app" ||
    payload.answers.length !== 1 ||
    payload.answers[0]?.id !== "yes" ||
    payload.answers[0]?.label !== "Yes" ||
    !payload.answeredAt.endsWith("Z")
  ) {
    throw new Error("spec payload mismatch");
  }
  console.log("pass webhook delivery reached delivered with the spec payload");
  console.log("smoke ok");
} finally {
  try {
    if (botId) await rm(join(configDir, `${botId}.key`), { force: true });
    await clearSmoke();
    const left = await inlineQuery(`
      const bots = (await ctx.db.query("bots").take(40)).filter((row) => row.name.startsWith(${JSON.stringify(botName)})).map((row) => row.name);
      const device = (await ctx.db.query("device").take(5)).length;
      return { bots, device };
    `);
    const names = Array.isArray(left.bots) ? left.bots : ["unknown"];
    if (names.length !== 0 || left.device !== 0) {
      throw new Error(`test rows remain device=${String(left.device)} bots=${names.length}`);
    }
    console.log("pass cleanup device=0 testBots=0");
  } catch (error) {
    process.exitCode = 1;
    console.error(safe(error instanceof Error ? error.message : "cleanup failed"));
  }
}
