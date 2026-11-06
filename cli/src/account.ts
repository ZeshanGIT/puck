import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import {
  ClerkSignInError,
  beginGoogleSignIn,
  callbackProblem,
  clerkFrontendApi,
  endClerkSession,
  fetchConvexToken,
  finishGoogleSignIn,
  hasClerkReturn,
  nonceFromCallback,
  readClerkAccount,
  type ClerkAccount,
} from "@puck/shared";
import { CliError } from "./errors";
import { callbackBridgeHtml, loginPageHtml, signInFailedPageHtml, signedInPageHtml } from "./loginPage";

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
  const account = await runClerkLogin({ frontendApi, open, fetchImpl });
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

export async function runClerkLogin(options: {
  frontendApi: string;
  open: (url: string) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ClerkAccount> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3 * 60 * 1000;
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new ClerkSignInError("could not open the sign-in page", "rejected"));
        return;
      }
      resolve(address.port);
    });
  });

  const origin = `http://localhost:${port}`;
  let attempt: Awaited<ReturnType<typeof beginGoogleSignIn>>;
  try {
    attempt = await beginGoogleSignIn({
      frontendApi: options.frontendApi,
      redirectUrl: `${origin}/callback`,
      fetchImpl,
    });
  } catch (error) {
    server.close();
    throw asCli(error);
  }

  return new Promise<ClerkAccount>((resolve, reject) => {
    let settled = false;
    let completing = false;
    const finish = (error: Error | null, account?: ClerkAccount) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else if (account) resolve(account);
    };
    const timer = setTimeout(() => {
      finish(new CliError("sign-in timed out"));
    }, timeoutMs);

    server.on("request", (request, response) => {
      void handleLoginRequest(request, response, attempt, options.frontendApi, fetchImpl, finish, () => {
        if (completing || settled) return false;
        completing = true;
        return true;
      });
    });
    options.open(`${origin}/`);
  });
}

async function handleLoginRequest(
  request: IncomingMessage,
  response: ServerResponse,
  attempt: Awaited<ReturnType<typeof beginGoogleSignIn>>,
  frontendApi: string,
  fetchImpl: typeof fetch,
  finish: (error: Error | null, account?: ClerkAccount) => void,
  claim: () => boolean,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, 200, loginPageHtml(attempt.verificationUrl));
    return;
  }
  if (url.pathname !== "/callback") {
    sendHtml(response, 404, signInFailedPageHtml("That page is not part of sign-in."));
    return;
  }
  if (request.method === "GET" && !hasClerkReturn(url.toString())) {
    sendHtml(response, 200, callbackBridgeHtml());
    return;
  }
  const target =
    request.method === "POST" ? await readCallbackBody(request) : request.method === "GET" ? url.toString() : null;
  if (!target) {
    sendHtml(response, 404, signInFailedPageHtml("That page is not part of sign-in."));
    return;
  }
  if (!claim()) {
    sendHtml(response, 409, signInFailedPageHtml("Sign-in is already finishing."));
    return;
  }
  const problem = callbackProblem(target);
  if (problem) {
    sendHtml(response, 400, signInFailedPageHtml(problem));
    finish(new CliError(problem));
    return;
  }
  try {
    const account = await finishGoogleSignIn({
      frontendApi,
      clientJwt: attempt.clientJwt,
      signInId: attempt.signInId,
      rotatingTokenNonce: nonceFromCallback(target) ?? "",
      callbackUrl: target,
      devBrowser: attempt.devBrowser,
      fetchImpl,
    });
    sendHtml(response, 200, signedInPageHtml(account.email));
    finish(null, account);
  } catch (error) {
    const cli = asCli(error);
    sendHtml(response, 400, signInFailedPageHtml(cli.message));
    finish(cli);
  }
}

async function readCallbackBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 32768) return null;
    chunks.push(bytes);
  }
  let parsed: URL;
  try {
    parsed = new URL(Buffer.concat(chunks).toString("utf8").trim());
  } catch {
    return null;
  }
  if (parsed.pathname !== "/callback") return null;
  return parsed.toString();
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
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
