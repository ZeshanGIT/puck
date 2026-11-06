export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** Drop secret values before anything is written to a terminal or a log. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** Convex wraps handler failures. Keep the handler sentence, not the request id. */
export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "request failed";
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const uncaught = lines.find((line) => line.includes("Uncaught Error:"));
  const text = uncaught
    ? uncaught.replace(/^.*Uncaught Error:\s*/u, "")
    : (lines[lines.length - 1] ?? "request failed");
  return text.replace(/\[Request ID:[^\]]+\]\s*/gu, "");
}
