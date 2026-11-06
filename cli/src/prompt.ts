import type { Readable, Writable } from "node:stream";
import { CliError } from "./errors";

const pending = new WeakMap<Readable, string>();

/**
 * Read one line from a pipe without writing it back.
 * A hidden prompt must not echo the webhook header.
 */
export function readPipedLine(input: Readable): Promise<string> {
  const buffered = pending.get(input) ?? "";
  const ready = buffered.indexOf("\n");
  if (ready >= 0) {
    pending.set(input, buffered.slice(ready + 1));
    return Promise.resolve(buffered.slice(0, ready).replace(/\r$/u, ""));
  }

  return new Promise((resolve, reject) => {
    let buf = buffered;
    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      cleanup();
      pending.set(input, buf.slice(nl + 1));
      resolve(buf.slice(0, nl).replace(/\r$/u, ""));
    };
    const onEnd = () => {
      cleanup();
      pending.delete(input);
      if (!buf) reject(new CliError("missing input"));
      else resolve(buf.replace(/\r$/u, ""));
    };
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.pause();
    };
    input.on("data", onData);
    input.on("end", onEnd);
    input.resume();
  });
}

/** Apply one raw keystroke. Printable characters are kept and not echoed. */
export function applyHiddenChar(state: string, ch: string): { state: string; done: boolean; echo: string } {
  if (ch === "\r" || ch === "\n") return { state, done: true, echo: "\n" };
  if (ch === "\u007f" || ch === "\b") return { state: state.slice(0, -1), done: false, echo: "" };
  if (ch < " " && ch !== "\t") return { state, done: false, echo: "" };
  return { state: state + ch, done: false, echo: "" };
}

function readRawLine(input: NodeJS.ReadStream, output: Writable): Promise<string> {
  return new Promise((resolve) => {
    const previous = input.isRaw;
    input.setRawMode(true);
    (input as { ref?: () => void }).ref?.();
    input.resume();
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\u0003") {
          cleanup();
          output.write("\n");
          process.kill(process.pid, "SIGINT");
          return;
        }
        const next = applyHiddenChar(value, ch);
        value = next.state;
        if (next.echo) output.write(next.echo);
        if (next.done) {
          cleanup();
          resolve(value);
          return;
        }
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      if (input.isTTY) input.setRawMode(previous);
      // A flowing or referenced stdin keeps the process alive after the last prompt.
      input.pause();
      (input as { unref?: () => void }).unref?.();
    };
    input.on("data", onData);
  });
}

export async function promptHidden(
  label: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<string> {
  output.write(label);
  if ("isTTY" in input && input.isTTY && "setRawMode" in input && typeof input.setRawMode === "function") {
    return readRawLine(input as NodeJS.ReadStream, output);
  }
  return readPipedLine(input);
}

/**
 * Webhook URL and Authorization header.
 * Both env vars are for a non-interactive script. They are not flags, so a bot's command line never carries the header.
 */
export async function readPairingSecrets(
  env: NodeJS.ProcessEnv,
  prompt: (label: string) => Promise<string>,
): Promise<{ webhookUrl: string; webhookHeader: string }> {
  const url = env.PUCK_WEBHOOK_URL?.trim() ?? "";
  const header = env.PUCK_WEBHOOK_HEADER?.trim() ?? "";
  if (url || header) {
    if (!url || !header) throw new CliError("set both webhook variables or neither");
    return { webhookUrl: url, webhookHeader: header };
  }
  const webhookUrl = (await prompt("Webhook URL: ")).trim();
  const webhookHeader = (await prompt("Authorization header: ")).trim();
  if (!webhookUrl || !webhookHeader) throw new CliError("webhook URL and Authorization header are required");
  return { webhookUrl, webhookHeader };
}
