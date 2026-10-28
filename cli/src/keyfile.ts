import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isBotId } from "@puck/shared";
import { CliError } from "./errors";

function keyPath(configDir: string, botId: string): string {
  if (!isBotId(botId)) throw new CliError("bot id is not valid");
  return join(configDir, `${botId}.key`);
}

/** Write the bot secret once. The file is mode 0600 and the secret is not returned for printing. */
export async function writeBotKey(configDir: string, botId: string, secret: string): Promise<void> {
  if (!secret.trim()) throw new CliError("could not store the bot key");
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);
  const path = keyPath(configDir, botId);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch {
    throw new CliError("could not store the bot key");
  }
  try {
    await handle.writeFile(`${secret}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

export async function readBotKey(configDir: string, botId: string): Promise<string> {
  const path = keyPath(configDir, botId);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new CliError(`no key file for ${botId}`);
  }
  const secret = text.trim();
  if (!secret) throw new CliError(`no key file for ${botId}`);
  return secret;
}
