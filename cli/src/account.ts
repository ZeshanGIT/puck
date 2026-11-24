import { runClerkLogin } from "@puck/client/loopback";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import {
  ClerkSignInError,
  clerkFrontendApi,
  endClerkSession,
  fetchConvexToken,
  readClerkAccount,
  type ClerkAccount,
} from "@puck/shared";
import { CliError } from "./errors";

const SESSION_FILE = "session.json";

export function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(command, [url], () => {});
}

export async function writeSession(configDir: string, account: ClerkAccount): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);
  const path = join(configDir, SESSION_FILE);
  await writeFile(path, `${JSON.stringify(account)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

export async function readSession(configDir: string): Promise<ClerkAccount | null> {
  let text: string;
  try {
    text = await readFile(join(configDir, SESSION_FILE), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isAccount(parsed)) return null;
  return parsed;
}

export async function deleteSession(configDir: string): Promise<void> {
  await rm(join(configDir, SESSION_FILE), { force: true });
}

export async function login(
  configDir: string,
  env: NodeJS.ProcessEnv,
  open: (url: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const frontendApi = clerkHost(env);
  const account = await runClerkLogin({ frontendApi, open, fetchImpl }).catch((error: unknown) => {
    throw asCli(error);
  });
  await writeSession(configDir, account);
  return accountLines(account);
}

/**
 * The Clerk Convex token for the stored session, or null when signed out or the token cannot be
 * fetched (then the caller uses the typed-code flow).
 */
export async function signedInToken(configDir: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const stored = await readSession(configDir);
  if (!stored) return null;
  try {
    return await fetchConvexToken({ frontendApi: clerkHost(env), account: stored });
  } catch {
    return null;
  }
}

export async function whoami(
  configDir: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const stored = await readSession(configDir);
  if (!stored) throw new CliError("not signed in");
  try {
    const account = await readClerkAccount({
      frontendApi: clerkHost(env),
      clientJwt: stored.clientJwt,
      devBrowser: stored.devBrowser,
      fetchImpl,
    });
    await writeSession(configDir, account);
    return accountLines(account);
  } catch (error) {
    if (error instanceof ClerkSignInError && error.code === "signed-out") {
      await deleteSession(configDir);
      throw new CliError("not signed in");
    }
    throw asCli(error);
  }
}

export async function logout(
  configDir: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const stored = await readSession(configDir);
  if (stored) {
    await endClerkSession({ frontendApi: clerkHost(env), account: stored, fetchImpl });
  }
  await deleteSession(configDir);
  return "signed out\n";
}

function accountLines(account: ClerkAccount): string {
  return `${account.email}\n${account.userId}\n`;
}

function clerkHost(env: NodeJS.ProcessEnv): string {
  try {
    return clerkFrontendApi(env.PUCK_CLERK_FRONTEND_API);
  } catch (error) {
    throw asCli(error);
  }
}

function asCli(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof ClerkSignInError) return new CliError(error.message);
  return new CliError("could not sign in");
}

function isAccount(value: unknown): value is ClerkAccount {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Partial<ClerkAccount>;
  const jwt = typeof account.clientJwt === "string" && account.clientJwt.startsWith("eyJ");
  const browser = typeof account.devBrowser === "string" && account.devBrowser.startsWith("dvb_");
  return (
    (jwt || browser) &&
    typeof account.sessionId === "string" &&
    account.sessionId.startsWith("sess_") &&
    typeof account.userId === "string" &&
    account.userId.startsWith("user_") &&
    typeof account.email === "string" &&
    account.email.includes("@")
  );
}
