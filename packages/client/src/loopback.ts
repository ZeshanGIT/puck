import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ClerkSignInError,
  beginGoogleSignIn,
  callbackProblem,
  finishGoogleSignIn,
  hasClerkReturn,
  nonceFromCallback,
  type ClerkAccount,
} from "@puck/shared";
import { callbackBridgeHtml, loginPageHtml, signInFailedPageHtml, signedInPageHtml } from "./loginPage";

export { callbackBridgeHtml, loginPageHtml } from "./loginPage";

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
    throw loginError(error);
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
      finish(new ClerkSignInError("sign-in timed out", "rejected"));
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
    finish(new ClerkSignInError(problem, "rejected"));
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
    const failure = loginError(error);
    sendHtml(response, 400, signInFailedPageHtml(failure.message));
    finish(failure);
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

function loginError(error: unknown): ClerkSignInError {
  if (error instanceof ClerkSignInError) return error;
  return new ClerkSignInError("could not sign in", "rejected");
}
