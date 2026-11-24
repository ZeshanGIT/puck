import { hostname as osHostname } from "node:os";
import type { Readable } from "node:stream";
import {
  AlertValidationError,
  BOT_MESSAGE_INPUT_ERROR,
  readBotMessage,
  BOT_COLOURS,
  BOT_SHAPES,
  isBotShape,
  isBotId,
  isQuestionId,
  validateAlertTiming,
  validateCreateAlert,
  validateLiveCommand,
  validatePairingInput,
  type LiveCommand,
  type PairingInput,
} from "@puck/shared";
import type { AlertBody, AlertStatusView, Backend, ListedAlert, PairingStatus } from "./backend";
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
  /** Avatar shape: round, squircle, hex, bean or cloud. */
  shape?: string;
  /** `--no-webhook`: pair with no webhook; the bot reads its answers (`puck answer`, `send --wait`). */
  noWebhook?: boolean;
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
  // Checked before the webhook questions, so a typo does not cost a pasted secret.
  if (colour !== undefined && !(BOT_COLOURS as readonly string[]).includes(colour)) {
    throw new CliError(`colour must be one of: ${BOT_COLOURS.join(", ")}`);
  }
  if (options.shape !== undefined && !isBotShape(options.shape)) {
    throw new CliError(`shape must be one of: ${BOT_SHAPES.join(", ")}`);
  }
  if (options.noWebhook && (runtime.env.PUCK_WEBHOOK_URL?.trim() || runtime.env.PUCK_WEBHOOK_HEADER?.trim())) {
    throw new CliError("--no-webhook, but PUCK_WEBHOOK_URL or PUCK_WEBHOOK_HEADER is set: unset them, or drop --no-webhook");
  }
  const config = await loadConfig(runtime.configDir, runtime.env);
  const secrets = options.noWebhook
    ? { webhookUrl: "", webhookHeader: "" }
    : await readPairingSecrets(runtime.env, runtime.prompt);
  const addedFrom = machineName(runtime.hostname ? runtime.hostname() : osHostname());
  let pairing: PairingInput;
  try {
    pairing = validatePairingInput({
      name,
      webhookUrl: secrets.webhookUrl,
      webhookHeader: secrets.webhookHeader,
      ...(colour === undefined ? {} : { colour }),
      ...(options.shape === undefined ? {} : { shape: options.shape }),
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

export async function sendBotMessage(
  input: { to: string; bot?: string; file?: string },
  runtime: Runtime,
): Promise<string> {
  if (!isBotId(input.to)) throw new CliError("target bot id is not valid");
  const message = readBotMessage(await readAlertJson(input.file, process.stdin));
  if (message === null) throw new CliError(BOT_MESSAGE_INPUT_ERROR);
  const { config, botId, secret } = await openBot(input.bot, runtime);
  await runtime.backend.postBotMessage(config.siteUrl, botId, secret, { to: input.to, message });
  return "bot message queued\n";
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

/** How often `puck send --wait` asks for the answer. */
export const WAIT_POLL_MS = 3_000;
/** The default `--timeout`. */
export const WAIT_DEFAULT_MS = 30 * 60_000;
/** Failed checks in a row (network, server) before `--wait` gives up. */
const WAIT_MAX_FAILURES = 5;

/**
 * Exit codes of `puck send --wait`, so a bot can branch without reading the output. 1 stays every
 * error (bad alert, not paired, network).
 */
export const WAIT_EXIT = { answered: 0, snoozed: 3, cancelled: 4, timedOut: 5 } as const;

export interface WaitOptions {
  timeoutMs: number;
  /** Keep waiting while the alert is snoozed, instead of returning. */
  throughSnooze: boolean;
}

/**
 * Asks for the alert until it is answered, cancelled, snoozed (unless `throughSnooze`) or the time
 * is up, and prints the alert as `puck answer --json` does. The exit code says which.
 */
export async function waitForAnswer(
  questionId: string,
  bot: string | undefined,
  wait: WaitOptions,
  runtime: Runtime,
): Promise<{ text: string; exitCode: number }> {
  const { config, botId, secret } = await openBot(bot, runtime);
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + wait.timeoutMs;
  let failures = 0;
  let last: AlertStatusView | null = null;
  for (;;) {
    try {
      last = await runtime.backend.getAlert(config.siteUrl, botId, secret, questionId);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= WAIT_MAX_FAILURES) throw error;
    }
    if (last) {
      const exitCode =
        last.answer !== null || last.status === "answered"
          ? WAIT_EXIT.answered
          : last.status === "cancelled"
            ? WAIT_EXIT.cancelled
            : last.status === "snoozed" && !wait.throughSnooze
              ? WAIT_EXIT.snoozed
              : null;
      if (exitCode !== null) return { text: `${JSON.stringify(last, null, 2)}\n`, exitCode };
    }
    if (now() >= deadline) {
      if (!last) throw new CliError("could not read the alert before the timeout");
      return { text: `${JSON.stringify(last, null, 2)}\n`, exitCode: WAIT_EXIT.timedOut };
    }
    await sleep(Math.min(WAIT_POLL_MS, Math.max(0, deadline - now())));
  }
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

/**
 * An alert id as the person or agent typed it, in Puck's form (`q_` then 16 capitals and digits).
 * Ids are matched case-insensitively, so `Q_JNWG…` or `q_jnwg…` (an agent retyping the id) still
 * finds the alert; anything else is refused.
 */
export function alertIdArg(raw: string): string {
  const trimmed = raw.trim();
  const id = /^q_/iu.test(trimmed) ? `q_${trimmed.slice(2).toUpperCase()}` : trimmed;
  if (!isQuestionId(id)) throw new CliError("alert id is not valid: it looks like q_ followed by 16 letters and digits");
  return id;
}

export async function cancelAlert(rawId: string, bot: string | undefined, runtime: Runtime): Promise<string> {
  const questionId = alertIdArg(rawId);
  const { config, botId, secret } = await openBot(bot, runtime);
  await runtime.backend.cancelAlert(config.siteUrl, botId, secret, questionId);
  return `cancelled ${questionId}\n`;
}

/**
 * `puck answer <id>`: what the person replied to one alert, so an agent can check a reply made it
 * through. `json` prints the validated view instead of text.
 */
export async function getAnswer(
  rawId: string,
  bot: string | undefined,
  runtime: Runtime,
  json = false,
): Promise<string> {
  const questionId = alertIdArg(rawId);
  const { config, botId, secret } = await openBot(bot, runtime);
  const view = await runtime.backend.getAlert(config.siteUrl, botId, secret, questionId);
  return json ? `${JSON.stringify(view, null, 2)}\n` : formatAnswer(view);
}

export function formatAnswer(view: AlertStatusView): string {
  const lines = [`${view.questionId}  ${view.status}  ${view.question}`];
  const answer = view.answer;
  if (answer) {
    if (answer.answers.length > 0) {
      lines.push(`answer: ${answer.answers.map((choice) => (choice.label === choice.id ? choice.id : `${choice.label} (${choice.id})`)).join(", ")}`);
    }
    if (answer.customReply !== null && answer.customReply !== "") lines.push(`reply: ${answer.customReply}`);
    for (const file of answer.attachments) lines.push(`attachment: ${file.name} (${file.type}, ${file.size} bytes) ${file.url}`);
    lines.push(`answered: ${formatLocal(Date.parse(answer.answeredAt))}`);
    if (answer.deliveryStatus === "delivered" && answer.deliveryAttempts === 0) lines.push("delivery: none (no webhook)");
    else lines.push(`delivery: ${answer.deliveryStatus} (${answer.deliveryAttempts} attempt${answer.deliveryAttempts === 1 ? "" : "s"})`);
    if (answer.lastError) lines.push(`error: ${answer.lastError}`);
  } else if (view.status === "cancelled") {
    lines.push("cancelled");
  } else if (view.status === "snoozed") {
    lines.push(view.snoozedUntil === null ? "snoozed until they're back, no answer yet" : `snoozed until ${formatLocal(Date.parse(view.snoozedUntil))}, no answer yet`);
  } else {
    lines.push("no answer yet");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * `puck bot set-webhook`. Reads `PUCK_WEBHOOK_URL` and `PUCK_WEBHOOK_HEADER` (same as `puck add`).
 * Requires sign-in; bot id and pairing stay the same.
 */
export async function setBotWebhook(bot: string | undefined, runtime: Runtime): Promise<string> {
  const token = runtime.convexToken ? await runtime.convexToken() : null;
  if (!token) throw new CliError("sign in with puck login to update a webhook");
  const config = await loadConfig(runtime.configDir, runtime.env);
  const botId = bot ?? config.defaultBot;
  if (!botId) throw new CliError("pass --bot <bot-id>");
  if (!isBotId(botId)) throw new CliError("bot id is not valid");
  const secrets = await readPairingSecrets(runtime.env, runtime.prompt);
  let pairing: PairingInput;
  try {
    pairing = validatePairingInput({ name: "unused", webhookUrl: secrets.webhookUrl, webhookHeader: secrets.webhookHeader });
  } catch (error) {
    if (error instanceof AlertValidationError) throw new CliError(error.message);
    throw error;
  }
  await runtime.backend.updateWebhook(
    config.deploymentUrl,
    botId,
    { webhookUrl: pairing.webhookUrl, webhookHeader: pairing.webhookHeader },
    token,
  );
  return `webhook updated for ${botId}\n`;
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

/** The `puck status` input, as the program parses it. */
export interface StatusInput {
  action: "start" | "step" | "steps" | "note" | "end";
  /** What is happening now: on its own (note), or with start, step or end. */
  note?: string;
  bot?: string;
  title?: string;
  /** Steps separated by `|`, for start and steps. */
  steps?: string;
  link?: string;
  /** The step text, for step. */
  text?: string;
  ok?: boolean;
  failed?: boolean;
}

/** Splits `A|B|C`. An empty piece is kept, so the validator names it. */
export function parseSteps(raw: string): string[] {
  return raw.split("|").map((piece) => piece.trim());
}

/**
 * `puck status`: start, step, steps or end a live activity for the bot. The body is checked with
 * the same validator the server uses, so a bad one fails here with a short message.
 */
export async function statusCommand(input: StatusInput, runtime: Runtime): Promise<string> {
  let raw: Record<string, unknown>;
  switch (input.action) {
    case "start":
      raw = {
        action: "start",
        title: input.title ?? "",
        ...(input.steps === undefined ? {} : { steps: parseSteps(input.steps) }),
        ...(input.link === undefined ? {} : { link: input.link }),
        ...(input.note === undefined ? {} : { note: input.note }),
      };
      break;
    case "step":
      raw = { action: "step", step: input.text ?? "", ...(input.note === undefined ? {} : { note: input.note }) };
      break;
    case "note":
      raw = { action: "note", note: input.note ?? "" };
      break;
    case "steps":
      raw = { action: "steps", steps: parseSteps(input.steps ?? "") };
      break;
    case "end":
      if (input.ok && input.failed) throw new CliError("pass --ok or --failed, not both");
      raw = { action: "end", state: input.failed ? "failed" : "done", ...(input.note === undefined ? {} : { note: input.note }) };
      break;
  }
  let command: LiveCommand;
  try {
    command = validateLiveCommand(raw);
  } catch (error) {
    if (error instanceof AlertValidationError) throw new CliError(error.message);
    throw error;
  }
  const { config, botId, secret } = await openBot(input.bot, runtime);
  await runtime.backend.postStatus(config.siteUrl, botId, secret, command);
  switch (command.action) {
    case "start":
      return "started\n";
    case "step":
      return `step: ${command.step}\n`;
    case "steps":
      return `steps: ${command.steps.length}\n`;
    case "note":
      return `note: ${command.note}\n`;
    case "end":
      return `ended: ${command.state}\n`;
  }
}
