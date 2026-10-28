import { AlertValidationError, isBotId, validatePairingInput, type PairingInput } from "@puck/shared";
import type { AlertBody, Backend } from "./backend";
import { loadConfig } from "./config";
import { CliError, PHASE_8 } from "./errors";
import { readBotKey, writeBotKey } from "./keyfile";
import { optionsFromLabels } from "./ids";
import { readPairingSecrets } from "./prompt";

export interface Runtime {
  env: NodeJS.ProcessEnv;
  configDir: string;
  stdout: (text: string) => void;
  prompt: (label: string) => Promise<string>;
  backend: Backend;
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

export interface AskInput {
  question: string;
  labels: readonly string[];
  multi: boolean;
  priority: "normal" | "urgent";
  bot?: string;
  at?: string;
}

export async function askQuestion(input: AskInput, runtime: Runtime): Promise<string> {
  if (input.at) throw new CliError(PHASE_8);
  const question = input.question.trim();
  if (!question) throw new CliError("question is required");
  if (input.labels.length === 0) throw new CliError("ask needs at least one option");
  const config = await loadConfig(runtime.configDir, runtime.env);
  const botId = input.bot ?? config.defaultBot;
  if (!botId) throw new CliError("pass --bot <bot-id>");
  if (!isBotId(botId)) throw new CliError("bot id is not valid");
  const secret = await readBotKey(runtime.configDir, botId);
  const body: AlertBody = {
    question,
    priority: input.priority,
    selectionMode: input.multi ? "multi" : "single",
    options: optionsFromLabels(input.labels),
  };
  const posted = await runtime.backend.postAlert(config.siteUrl, botId, secret, body);
  return `${posted.questionId}\n`;
}

export function sendQuestion(
  input: { message: string; priority: "normal" | "urgent"; bot?: string; at?: string },
  runtime: Runtime,
): Promise<string> {
  return askQuestion(
    { question: input.message, labels: ["OK"], multi: false, priority: input.priority, bot: input.bot, at: input.at },
    runtime,
  );
}
