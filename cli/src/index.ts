#!/usr/bin/env bun
import { CommanderError } from "commander";
import { CliError } from "./errors";
import { createProgram } from "./program";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }
  if (error instanceof CommanderError) {
    process.exit(error.exitCode);
  }
  process.stderr.write("puck: failed\n");
  process.exit(1);
}
