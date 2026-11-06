import { readFile } from "node:fs/promises";
import type { Readable } from "node:stream";
import { CliError } from "./errors";

/** Alert JSON from `--file`, or from stdin when it is a pipe. */
export async function readAlertJson(file: string | undefined, stdin: Readable): Promise<unknown> {
  if (file) return parseAlert(await readAlertFile(file));
  if ("isTTY" in stdin && stdin.isTTY === true) {
    throw new CliError("pass --file or pipe the alert JSON");
  }
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
  } catch {
    throw new CliError("could not read the alert JSON");
  }
  return parseAlert(Buffer.concat(chunks).toString("utf8"));
}

async function readAlertFile(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new CliError("could not read the alert file");
  }
}

function parseAlert(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliError("alert JSON is not valid");
  }
}
