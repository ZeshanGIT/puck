#!/usr/bin/env bun
import { Command, InvalidArgumentError } from "commander";
import { MAX_OPTIONS } from "@puck/shared";
import pkg from "../package.json" with { type: "json" };

// Thin client over the Puck HTTP API. Commands are stubs until the
// backend endpoints exist; see the v0 spec for the intended behaviour.

function notImplemented(command: string): never {
  console.error(`puck ${command}: not implemented yet`);
  process.exit(1);
}

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

const program = new Command()
  .name("puck")
  .description("Page your phone from an AI agent")
  .version(pkg.version);

program
  .command("send")
  .description("send a one-way alert and return at once")
  .argument("<message>", "alert text")
  .action(() => notImplemented("send"));

program
  .command("ask")
  .description("ring the phone and wait for a reply, printed as JSON")
  .argument("<message>", "alert text")
  .option("--options <list>", `comma-separated reply options (max ${MAX_OPTIONS})`, parseOptions)
  .option("--text", "allow a free-text reply")
  .option("--webhook <url>", "return at once and POST the reply to this URL")
  .option("--timeout <seconds>", "how long to wait for a reply")
  .action(() => notImplemented("ask"));

program
  .command("schedule")
  .description("ring at a set time; same options as ask")
  .argument("<message>", "alert text")
  .requiredOption("--at <time>", "when to ring, e.g. 06:00 or an ISO date-time")
  .option("--options <list>", `comma-separated reply options (max ${MAX_OPTIONS})`, parseOptions)
  .option("--text", "allow a free-text reply")
  .option("--webhook <url>", "POST the reply to this URL")
  .action(() => notImplemented("schedule"));

program
  .command("list")
  .description("list pending and scheduled alerts")
  .action(() => notImplemented("list"));

program
  .command("cancel")
  .description("cancel a pending or scheduled alert")
  .argument("<id>", "alert id")
  .action(() => notImplemented("cancel"));

await program.parseAsync();
