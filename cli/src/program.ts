import { Command } from "commander";
import { versionLine } from "./build";
import { login, logout, openBrowser, signedInToken, whoami } from "./account";
import { liveBackend } from "./backend";
import {
  addBot,
  cancelAlert,
  getAnswer,
  listAlerts,
  scheduleAlert,
  sendAlert,
  sendBotMessage,
  setBotWebhook,
  statusCommand,
  WAIT_DEFAULT_MS,
  waitForAnswer,
  type Runtime,
} from "./commands";
import { CliError } from "./errors";
import { parseDuration } from "./time";
import { defaultConfigDir } from "./config";
import { promptHidden } from "./prompt";

export function defaultRuntime(): Runtime {
  return {
    env: process.env,
    configDir: defaultConfigDir(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    prompt: (label) => promptHidden(label),
    backend: liveBackend,
    convexToken: () => signedInToken(defaultConfigDir(), process.env),
  };
}

export function createProgram(runtime: Runtime = defaultRuntime()): Command {
  const program = new Command()
    .name("puck")
    .description("Page your phone from an AI agent")
    .version(versionLine);
  program.exitOverride();

  program
    .command("login")
    .description("sign in with Google")
    .action(async () => {
      runtime.stderr?.("Opening a browser to sign in with Google.\n");
      runtime.stdout(await login(runtime.configDir, runtime.env, runtime.open ?? openBrowser));
    });

  program
    .command("whoami")
    .description("show the signed-in Google account")
    .action(async () => {
      runtime.stdout(await whoami(runtime.configDir, runtime.env));
    });

  program
    .command("logout")
    .description("sign out of this computer")
    .action(async () => {
      runtime.stdout(await logout(runtime.configDir, runtime.env));
    });

  program
    .command("add")
    .description("pair a bot and print its code and id")
    .argument("<name>", "bot name, such as sheldon")
    .option("--colour <name>", "bot colour, such as indigo")
    .option("--color <name>", "same as --colour")
    .option("--shape <name>", "avatar shape: round, squircle, hex, bean or cloud")
    .option("--no-webhook", "pair without a webhook; read answers with puck answer or puck send --wait")
    .action(async (name: string, options: { colour?: string; color?: string; shape?: string; webhook?: boolean }) => {
      const { webhook, ...rest } = options;
      runtime.stdout(await addBot(name, runtime, { ...rest, noWebhook: webhook === false }));
    });

  const status = program.command("status").description("report what the bot is working on (live activity)");
  status
    .command("start")
    .description("start an activity, replacing this bot's current one")
    .requiredOption("--title <text>", "what the bot is working on")
    .option("--steps <a|b|c>", "steps, separated by |")
    .option("--link <url>", "a link for the task")
    .option("--note <text>", "what is happening now, in a line")
    .option("--to <bot-id>", "page a bot on the same account with this activity update")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (options: { title: string; steps?: string; link?: string; note?: string; bot?: string; to?: string }) => {
      runtime.stdout(await statusCommand({ action: "start", ...options }, runtime));
    });
  status
    .command("step")
    .description("move to a step, adding it if it is new")
    .argument("<text>", "the step")
    .option("--note <text>", "what is happening now, in a line")
    .option("--to <bot-id>", "page a bot on the same account with this activity update")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (text: string, options: { note?: string; bot?: string; to?: string }) => {
      runtime.stdout(await statusCommand({ action: "step", text, ...options }, runtime));
    });
  status
    .command("note")
    .description("say what is happening now, on the current step (or the task, with no steps)")
    .argument("<text>", "the note, in a line")
    .option("--to <bot-id>", "page a bot on the same account with this activity update")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (text: string, options: { bot?: string; to?: string }) => {
      runtime.stdout(await statusCommand({ action: "note", note: text, ...options }, runtime));
    });
  status
    .command("steps")
    .description("replace the list of steps")
    .argument("<list>", "steps separated by |")
    .option("--to <bot-id>", "page a bot on the same account with this activity update")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (list: string, options: { bot?: string; to?: string }) => {
      runtime.stdout(await statusCommand({ action: "steps", steps: list, ...options }, runtime));
    });
  status
    .command("end")
    .description("end the activity")
    .option("--ok", "finished (the default)")
    .option("--failed", "finished with a failure")
    .option("--note <text>", "how it ended, in a line")
    .option("--to <bot-id>", "page a bot on the same account with this activity update")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (options: { ok?: boolean; failed?: boolean; note?: string; bot?: string; to?: string }) => {
      runtime.stdout(await statusCommand({ action: "end", ...options }, runtime));
    });

  program
    .command("send")
    .description("send an alert and return its id")
    .option("--file <path>", "JSON input file; stdin is used when omitted")
    .option("--to <bot-id>", 'page a bot on the same account with this alert')
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .option("--at <time>", "ring at HH:MM instead of immediately")
    .option("--wait", "wait for the answer and print it as JSON (exit 0 answered, 3 snoozed, 4 cancelled, 5 timed out)")
    .option("--timeout <duration>", "with --wait: how long to wait, such as 90s, 30m or 2h (default 30m)")
    .option("--through-snooze", "with --wait: keep waiting while the alert is snoozed")
    .action(
      async (options: { file?: string; bot?: string; to?: string; at?: string; wait?: boolean; timeout?: string; throughSnooze?: boolean }) => {
        if (options.to !== undefined) {
          if (options.at !== undefined || options.wait || options.timeout !== undefined || options.throughSnooze) {
            throw new CliError("--to cannot be used with --at, --wait, --timeout or --through-snooze");
          }
          runtime.stdout(await sendBotMessage({ ...options, to: options.to }, runtime));
          return;
        }
        if (!options.wait && (options.timeout !== undefined || options.throughSnooze)) {
          throw new CliError("--timeout and --through-snooze need --wait");
        }
        let timeoutMs = WAIT_DEFAULT_MS;
        if (options.timeout !== undefined) {
          try {
            timeoutMs = parseDuration(options.timeout);
          } catch (error) {
            throw new CliError(error instanceof Error ? error.message : "timeout is not valid");
          }
        }
        const sent = await sendAlert({ file: options.file, bot: options.bot, at: options.at }, runtime);
        if (!options.wait) {
          runtime.stdout(sent);
          return;
        }
        // The id goes to stderr at once, so a bot that is stopped while waiting can still look it up.
        const questionId = sent.trim();
        runtime.stderr?.(`${questionId} sent, waiting for the answer\n`);
        const result = await waitForAnswer(questionId, options.bot, { timeoutMs, throughSnooze: options.throughSnooze === true }, runtime);
        runtime.stdout(result.text);
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      },
    );

  program
    .command("schedule")
    .description("ring at a set time")
    .argument("<message>", "alert text")
    .option("--at <time>", "clock time HH:MM")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (message: string, options: { at?: string; bot?: string }) => {
      runtime.stdout(await scheduleAlert({ message, at: options.at, bot: options.bot }, runtime));
    });

  program
    .command("list")
    .description("list pending and scheduled alerts")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (options: { bot?: string }) => {
      runtime.stdout(await listAlerts(options.bot, runtime));
    });

  program
    .command("cancel")
    .description("cancel a pending or scheduled alert")
    .argument("<id>", "alert id")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (id: string, options: { bot?: string }) => {
      runtime.stdout(await cancelAlert(id, options.bot, runtime));
    });

  program
    .command("answer")
    .description("show the answer the person gave to an alert")
    .argument("<id>", "alert id")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .option("--json", "print the alert and answer as JSON")
    .action(async (id: string, options: { bot?: string; json?: boolean }) => {
      runtime.stdout(await getAnswer(id, options.bot, runtime, options.json === true));
    });

  const botCmd = program.command("bot").description("change a paired bot without re-pairing");
  botCmd
    .command("set-webhook")
    .description("set webhook URL and Authorization from PUCK_WEBHOOK_* env vars")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (options: { bot?: string }) => {
      runtime.stdout(await setBotWebhook(options.bot, runtime));
    });

  return program;
}
