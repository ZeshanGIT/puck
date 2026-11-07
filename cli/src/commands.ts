import { hostname as osHostname } from "node:os";
import type { Readable } from "node:stream";
import {
  AlertValidationError,
  isBotId,
  isQuestionId,
  validateAlertTiming,
  validateCreateAlert,
  validatePairingInput,
  type PairingInput,
} from "@puck/shared";
import type { AlertBody, Backend, ListedAlert, PairingStatus } from "./backend";
import { loadConfig } from "./config";
import { CliError } from "./errors";
import { readBotKey, writeBotKey } from "./keyfile";
import { readAlertJson } from "./payload";
import { readPairingSecrets } from "./prompt";
import { nextClockTime } from "./time";

export interface Runtime {
  env: NodeJS.ProcessEnv;
  configDir: string;
  stdout: (text: string) => void;
  stderr?: (text: string) => void;
  prompt: (label: string) => Promise<string>;
  backend: Backend;
  open?: (url: string) => void;
  /** Overridable for tests. Defaults: the machine's hostname, Date.now, and a real timer. */
  hostname?: () => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** The Clerk Convex token when signed in, else null. */
  convexToken?: () => Promise<string | null>;
}

/** How long `puck add` waits for the phone. The pairing request expires after 15 minutes. */
export const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
export const APPROVAL_POLL_MS = 2_000;

/** A machine name the server accepts as `addedFrom`, or undefined (the pairing then has none). */
export function machineName(raw: string): string | undefined {
  const trimmed = raw.trim();
  return /^[A-Za-z0-9._-]{1,253}$/u.test(trimmed) ? trimmed : undefined;
}

export interface ApprovalWait {
  poll: () => Promise<PairingStatus>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  intervalMs: number;
}

/**
 * Polls until the phone approves (returns) or rejects or lets the request lapse (throws a
 * CliError, so the process exits non-zero with a short message).
 */
export async function waitForApproval(wait: ApprovalWait): Promise<void> {
  const deadline = wait.now() + wait.timeoutMs;
  for (;;) {
    const status = await wait.poll();
    if (status === "paired") return;
    if (status === "rejected") throw new CliError("rejected on your phone; the bot was not added");
    if (status === "expired" || status === "not_found") {
      throw new CliError("the pairing request expired; run puck add again");
    }
    if (wait.now() >= deadline) throw new CliError("no answer on your phone; run puck add again");
    await wait.sleep(wait.intervalMs);
  }
}

export interface AddBotOptions {
  colour?: string;
  /** The same option as `colour`, spelled the American way. */
  color?: string;
}

/**
 * `puck add`. Signed in, the request goes to the user's phone and the CLI waits for approval
 * (the key is written only once approved). Not signed in, it prints the code as before.
 */
export async function addBot(name: string, runtime: Runtime, options: AddBotOptions = {}): Promise<string> {
  if (options.colour !== undefined && options.color !== undefined && options.colour !== options.color) {
    throw new CliError("give one colour: --colour or --color");
  }
  const colour = options.colour ?? options.color;
  const config = await loadConfig(runtime.configDir, runtime.env);
  const secrets = await readPairingSecrets(runtime.env, runtime.prompt);
  const addedFrom = machineName(runtime.hostname ? runtime.hostname() : osHostname());
  let pairing: PairingInput;
  try {
    pairing = validatePairingInput({
      name,
      webhookUrl: secrets.webhookUrl,
      webhookHeader: secrets.webhookHeader,
      ...(colour === undefined ? {} : { colour }),
      ...(addedFrom === undefined ? {} : { addedFrom }),
    });
  } catch (error) {
    if (error instanceof AlertValidationError) throw new CliError(error.message);
    throw error;
  }
  const token = runtime.convexToken ? await runtime.convexToken() : null;
  const created = await runtime.backend.createPairing(config.deploymentUrl, pairing, token);
  if (!isBotId(created.botId) || !/^\d{6}$/u.test(created.pairingCode)) {
    throw new CliError("pairing did not return a bot id and code");
  }
  const codeLines = `code: ${created.pairingCode}\nbot: ${created.botId}\n`;
  if (token === null) {
    await writeBotKey(runtime.configDir, created.botId, created.secret);
    return codeLines;
  }
  runtime.stdout(`${codeLines}Approve it on your phone. Waiting...\n`);
  await waitForApproval({
    poll: () => runtime.backend.pairingStatus(config.deploymentUrl, created.botId, created.secret),
    sleep: runtime.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: runtime.now ?? Date.now,
    timeoutMs: APPROVAL_TIMEOUT_MS,
    intervalMs: APPROVAL_POLL_MS,
  });
  await writeBotKey(runtime.configDir, created.botId, created.secret);
  return "approved\n";
}

async function openBot(bot: string | undefined, runtime: Runtime) {
  const config = await loadConfig(runtime.configDir, runtime.env);
  const botId = bot ?? config.defaultBot;
  if (!botId) throw new CliError("pass --bot <bot-id>");
  if (!isBotId(botId)) throw new CliError("bot id is not valid");
  const secret = await readBotKey(runtime.configDir, botId);
  return { config, botId, secret };
}

export async function sendAlert(
  input: { bot?: string; file?: string; stdin?: Readable; at?: string },
  runtime: Runtime,
): Promise<string> {
  const parsed = await readAlertJson(input.file, input.stdin ?? process.stdin);
  let alert;
  try {
    alert = validateCreateAlert(parsed);
  } catch (error) {
    if (error instanceof AlertValidationError) throw new CliError(error.message);
    throw error;
  }
  let scheduledFor = alert.scheduledFor;
  if (input.at) {
    let clock: number;
    try {
      clock = nextClockTime(input.at, Date.now());
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : "time must be HH:MM");
    }
    if (scheduledFor !== null && scheduledFor !== clock) throw new CliError("pass the time once");
    scheduledFor = clock;
  }
  // The same checks the backend makes on the final time, so a bad expiry is a short message here.
  try {
    validateAlertTiming({ scheduledFor, expiresAt: alert.expiresAt }, Date.now());
  } catch (error) {
    if (error instanceof AlertValidationError) throw new CliError(error.message);
    throw error;
  }
  const { config, botId, secret } = await openBot(input.bot, runtime);
  // Everything validateCreateAlert returned goes in; only the scheduled time is replaced by the
  // one worked out above (absent when the alert is not scheduled).
  const body: AlertBody = { ...alert, scheduledFor: scheduledFor ?? undefined };
  const posted = await runtime.backend.postAlert(config.siteUrl, botId, secret, body);
  return `${posted.questionId}\n`;
}

export async function scheduleAlert(
  input: { message: string; at?: string; bot?: string },
  runtime: Runtime,
): Promise<string> {
  if (!input.at) throw new CliError("pass --at HH:MM");
  let scheduledFor: number;
  try {
    scheduledFor = nextClockTime(input.at, Date.now());
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : "time must be HH:MM");
  }
  let alert;
  try {
    alert = validateCreateAlert({
      question: input.message,
      priority: "normal",
      selectionMode: "single",
      presentation: "choice",
      options: [{ id: "ok", label: "OK" }],
      scheduledFor,
    });
  } catch (error) {
    if (error instanceof AlertValidationError) throw new CliError(error.message);
    throw error;
  }
  const { config, botId, secret } = await openBot(input.bot, runtime);
  const posted = await runtime.backend.postAlert(config.siteUrl, botId, secret, {
    question: alert.question,
    priority: alert.priority,
    selectionMode: alert.selectionMode,
    presentation: alert.presentation,
    options: alert.options,
    scheduledFor,
  });
  return `${posted.questionId}\n`;
}

export async function listAlerts(bot: string | undefined, runtime: Runtime): Promise<string> {
  const { config, botId, secret } = await openBot(bot, runtime);
  const alerts = await runtime.backend.listAlerts(config.siteUrl, botId, secret);
  if (alerts.length === 0) return "no alerts\n";
  return `${alerts.map(formatListedAlert).join("\n")}\n`;
}

export async function cancelAlert(questionId: string, bot: string | undefined, runtime: Runtime): Promise<string> {
  if (!isQuestionId(questionId)) throw new CliError("alert id is not valid");
  const { config, botId, secret } = await openBot(bot, runtime);
  await runtime.backend.cancelAlert(config.siteUrl, botId, secret, questionId);
  return `cancelled ${questionId}\n`;
}

function formatListedAlert(alert: ListedAlert): string {
  const when = alert.scheduledFor === null ? "" : `  ${formatLocal(alert.scheduledFor)}`;
  return `${alert.questionId}  ${alert.status}${when}  ${alert.question}`;
}

function formatLocal(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}
