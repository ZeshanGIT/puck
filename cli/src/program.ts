import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { login, logout, openBrowser, signedInToken, whoami } from "./account";
import { liveBackend } from "./backend";
import {
  addBot,
  cancelAlert,
  listAlerts,
  scheduleAlert,
  sendAlert,
  setBotWebhook,
  statusCommand,
  type Runtime,
} from "./commands";
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
    .version(pkg.version);
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
    .action(async (name: string, options: { colour?: string; color?: string }) => {
      runtime.stdout(await addBot(name, runtime, options));
    });

  const status = program.command("status").description("report what the bot is working on (live activity)");
  status
    .command("start")
    .description("start an activity, replacing this bot's current one")
    .requiredOption("--title <text>", "what the bot is working on")
    .option("--steps <a|b|c>", "steps, separated by |")
    .option("--link <url>", "a link for the task")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (options: { title: string; steps?: string; link?: string; bot?: string }) => {
      runtime.stdout(await statusCommand({ action: "start", ...options }, runtime));
    });
  status
    .command("step")
    .description("move to a step, adding it if it is new")
    .argument("<text>", "the step")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (text: string, options: { bot?: string }) => {
      runtime.stdout(await statusCommand({ action: "step", text, ...options }, runtime));
    });
  status
    .command("steps")
    .description("replace the list of steps")
    .argument("<list>", "steps separated by |")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (list: string, options: { bot?: string }) => {
      runtime.stdout(await statusCommand({ action: "steps", steps: list, ...options }, runtime));
    });
  status
    .command("end")
    .description("end the activity")
    .option("--ok", "finished (the default)")
    .option("--failed", "finished with a failure")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .action(async (options: { ok?: boolean; failed?: boolean; bot?: string }) => {
      runtime.stdout(await statusCommand({ action: "end", ...options }, runtime));
    });

  program
    .command("send")
    .description("post an alert JSON file or stdin and return the question id")
    .option("--file <path>", "alert JSON file; stdin is used when this is omitted")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .option("--at <time>", "ring at HH:MM instead of immediately")
    .action(async (options: { file?: string; bot?: string; at?: string }) => {
      runtime.stdout(await sendAlert({ file: options.file, bot: options.bot, at: options.at }, runtime));
    });

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
