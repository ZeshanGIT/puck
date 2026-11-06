import type { Readable } from "node:stream";
import { AlertValidationError, isBotId, isQuestionId, validateCreateAlert, validatePairingInput, type PairingInput } from "@puck/shared";
import type { AlertBody, Backend, ListedAlert } from "./backend";
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
}

export async function addBot(name: string, runtime: Runtime): Promise<string> {
  const config = await loadConfig(runtime.configDir, runtime.env);
  const secrets = await readPairingSecrets(runtime.env, runtime.prompt);
  let pairing: PairingInput;
  try {
    pairing = validatePairingInput({ name, webhookUrl: secrets.webhookUrl, webhookHeader: secrets.webhookHeader });
  } catch (error) {
    if (error instanceof AlertValidationError) throw new CliError(error.message);
    throw error;
  }
  const created = await runtime.backend.createPairing(config.deploymentUrl, pairing);
  if (!isBotId(created.botId) || !/^\d{6}$/u.test(created.pairingCode)) {
    throw new CliError("pairing did not return a bot id and code");
  }
  await writeBotKey(runtime.configDir, created.botId, created.secret);
  return `code: ${created.pairingCode}\nbot: ${created.botId}\n`;
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
  const { config, botId, secret } = await openBot(input.bot, runtime);
  const body: AlertBody = {
    question: alert.question,
    priority: alert.priority,
    selectionMode: alert.selectionMode,
    presentation: alert.presentation,
    options: alert.options,
    ...(scheduledFor === null ? {} : { scheduledFor }),
  };
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
