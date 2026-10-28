import { InvalidArgumentError, Command } from "commander";
import { MAX_OPTIONS } from "@puck/shared";
import pkg from "../package.json" with { type: "json" };
import { liveBackend } from "./backend";
import { addBot, askQuestion, sendQuestion, type Runtime } from "./commands";
import { defaultConfigDir } from "./config";
import { CliError, PHASE_8 } from "./errors";
import { promptHidden } from "./prompt";

function parseOptions(value: string): string[] {
  const options = value
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
  if (options.length > MAX_OPTIONS) {
    throw new InvalidArgumentError(`at most ${MAX_OPTIONS} options`);
  }
  return options;
}

function parsePriority(value: string): "normal" | "urgent" {
  if (value !== "normal" && value !== "urgent") {
    throw new InvalidArgumentError("priority must be normal or urgent");
  }
  return value;
}

export function defaultRuntime(): Runtime {
  return {
    env: process.env,
    configDir: defaultConfigDir(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    prompt: (label) => promptHidden(label),
    backend: liveBackend,
  };
}

export function createProgram(runtime: Runtime = defaultRuntime()): Command {
  const program = new Command()
    .name("puck")
    .description("Page your phone from an AI agent")
    .version(pkg.version);
  program.exitOverride();

  program
    .command("add")
    .description("pair a bot and print its code and id")
    .argument("<name>", "bot name, such as sheldon")
    .action(async (name: string) => {
      runtime.stdout(await addBot(name, runtime));
    });

  program
    .command("send")
    .description("send a one-way alert and return at once")
    .argument("<message>", "alert text")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .option("--priority <priority>", "normal or urgent", parsePriority, "normal")
    .option("--at <time>", "rejected until phase 8")
    .action(async (message: string, options: { bot?: string; priority: "normal" | "urgent"; at?: string }) => {
      runtime.stdout(await sendQuestion({ message, priority: options.priority, bot: options.bot, at: options.at }, runtime));
    });

  program
    .command("ask")
    .description("ask a question and return at once with the question id")
    .argument("<question>", "question text")
    .requiredOption("--options <list>", `comma-separated choices (max ${MAX_OPTIONS})`, parseOptions)
    .option("--multi", "let the phone select more than one option")
    .option("--text", "custom replies are always allowed")
    .option("--bot <bot-id>", "bot id, or the default in config.json")
    .option("--priority <priority>", "normal or urgent", parsePriority, "normal")
    .option("--at <time>", "rejected until phase 8")
    .action(
      async (
        question: string,
        options: { options: string[]; multi?: boolean; bot?: string; priority: "normal" | "urgent"; at?: string },
      ) => {
        runtime.stdout(
          await askQuestion(
            {
              question,
              labels: options.options,
              multi: options.multi === true,
              priority: options.priority,
              bot: options.bot,
              at: options.at,
            },
            runtime,
          ),
        );
      },
    );

  program
    .command("schedule")
    .description("ring at a set time")
    .argument("<message>", "alert text")
    .option("--at <time>", "when to ring")
    .action(() => {
      throw new CliError(PHASE_8);
    });

  program
    .command("list")
    .description("list pending and scheduled alerts")
    .action(() => {
      throw new CliError(PHASE_8);
    });

  program
    .command("cancel")
    .description("cancel a pending or scheduled alert")
    .argument("<id>", "alert id")
    .action(() => {
      throw new CliError(PHASE_8);
    });

  return program;
}
