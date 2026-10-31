// Google sign-in against the Clerk Frontend API.
// The app and the CLI share this so a browser redirect can finish on the same client
// that started it. The client JWT is a secret: callers store it, and nothing here prints it.

/** Dev instance Frontend API host. Override from the environment when it changes. */
export const DEV_CLERK_FRONTEND_API = "in-lemming-9901.clerk.accounts.dev";

const FAPI_VERSION = "2026-08-20";
const CLERK_JS_VERSION = "6.41.0";

export type ClerkSignInCode = "unreachable" | "signed-out" | "rejected";

export class ClerkSignInError extends Error {
  readonly code: ClerkSignInCode;
  /** Clerk API error code when the Frontend API rejected the request. */
  readonly clerkCode?: string;

  constructor(message: string, code: ClerkSignInCode, clerkCode?: string) {
    super(message);
    this.name = "ClerkSignInError";
    this.code = code;
    this.clerkCode = clerkCode;
  }
}

/** A signed-in Clerk client. `clientJwt` is the long-lived client credential. `devBrowser` is the development-instance credential. */
export interface ClerkAccount {
  clientJwt: string;
  devBrowser?: string;
  sessionId: string;
  userId: string;
  email: string;
}

/** An in-progress Google sign-in. The browser returns to `redirectUrl`, with or without a nonce. */
export interface GoogleSignInAttempt {
  clientJwt: string;
  /** Development-instance credential. Sent as `__clerk_db_jwt`, never as `Authorization`, so a browser `Origin` is allowed. */
  devBrowser?: string;
  signInId: string;
  verificationUrl: string;
}

export function clerkFrontendApi(value: string | undefined): string {
  const raw = value?.trim() || DEV_CLERK_FRONTEND_API;
  const host = raw.replace(/^https:\/\//u, "").replace(/\/+$/u, "");
  if (!/^[a-z0-9.-]+$/u.test(host) || !host.includes(".")) {
    throw new ClerkSignInError("Clerk host is not valid", "rejected");
  }
  return host;
}

/** Clerk publishable keys are the Frontend API host, base64-encoded, with a `pk_test_` prefix in development. */
export function clerkPublishableKey(frontendApi: string): string {
  const host = clerkFrontendApi(frontendApi);
  const prefix = host.endsWith(".clerk.accounts.dev") || host.endsWith(".lcl.dev") ? "pk_test_" : "pk_live_";
  return prefix + btoa(`${host}$`).replace(/=+$/u, "");
}

/** `rotating_token_nonce` from a Clerk OAuth redirect, in the query or the hash. */
export function nonceFromCallback(url: string): string | null {
  const nonce = callbackParams(url)?.get("rotating_token_nonce")?.trim() ?? "";
  return nonce || null;
}

/** A failed Clerk redirect, or null when this URL can still be reloaded. */
export function callbackProblem(url: string): string | null {
  const params = callbackParams(url);
  if (!params || params.get("__clerk_status") !== "failed") return null;
  if (params.get("__clerk_error_code") === "oauth_access_denied") {
    return "You did not grant access to your account.";
  }
  return "Google did not complete sign-in.";
}

/** True when the redirect already carries a nonce, a dev handshake, or a Clerk error. */
export function hasClerkReturn(url: string): boolean {
  return Object.keys(clerkCallbackQuery(url)).length > 0 || callbackProblem(url) !== null;
}

const CALLBACK_QUERY_KEYS = [
  "rotating_token_nonce",
  "__clerk_handshake",
  "__clerk_handshake_nonce",
  "__clerk_created_session",
] as const;

/** Clerk return parameters to send back on the sign-in reload. Values stay out of logs and pages. */
export function clerkCallbackQuery(url: string): Record<string, string> {
  const params = callbackParams(url);
  if (!params) return {};
  const query: Record<string, string> = {};
  for (const key of CALLBACK_QUERY_KEYS) {
    const value = params.get(key)?.trim() ?? "";
    if (value) query[key] = value;
  }
  return query;
}

export async function beginGoogleSignIn(options: {
  frontendApi: string;
  redirectUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleSignInAttempt> {
  const frontendApi = clerkFrontendApi(options.frontendApi);
  const fetchImpl = options.fetchImpl ?? fetch;
  const redirectUrl = options.redirectUrl.trim();
  if (!redirectUrl) throw new ClerkSignInError("redirect URL is required", "rejected");

  const devBrowser = await openDevBrowser(frontendApi, fetchImpl);
  const started = await fapi({
    frontendApi,
    fetchImpl,
    method: "POST",
    path: "/client/sign_ins",
    devBrowser,
    body: {
      strategy: "oauth_google",
      redirect_url: redirectUrl,
      action_complete_redirect_url: redirectUrl,
    },
  });
  const response = record(record(started.body)?.response);
  const signInId = typeof response?.id === "string" ? response.id : "";
  const verification = record(response?.first_factor_verification);
  const verificationUrl =
    typeof verification?.external_verification_redirect_url === "string"
      ? verification.external_verification_redirect_url
      : "";
  if (!signInId.startsWith("sia_") || !verificationUrl.startsWith("https://")) {
    throw new ClerkSignInError("could not start Google sign-in", "rejected");
  }
  const browser = started.devBrowser || devBrowser;
  return { clientJwt: started.jwt, devBrowser: browser, signInId, verificationUrl: withDevBrowser(verificationUrl, browser) };
}

/** Native Google sign-in: exchange a Google ID token for a Clerk session (Android/iOS account picker). */
export async function signInWithGoogleOneTap(options: {
  frontendApi: string;
  idToken: string;
  fetchImpl?: typeof fetch;
}): Promise<ClerkAccount> {
  const frontendApi = clerkFrontendApi(options.frontendApi);
  const fetchImpl = options.fetchImpl ?? fetch;
  const idToken = options.idToken.trim();
  if (!idToken) throw new ClerkSignInError("Google did not return a token", "rejected");

  const devBrowser = await openDevBrowser(frontendApi, fetchImpl);
  try {
    const started = await fapi({
      frontendApi,
      fetchImpl,
      method: "POST",
      path: "/client/sign_ins",
      devBrowser,
      body: {
        strategy: "google_one_tap",
        token: idToken,
      },
    });
    return resolveGoogleOneTap(frontendApi, fetchImpl, started, devBrowser);
  } catch (error) {
    if (error instanceof ClerkSignInError && error.clerkCode === "external_account_not_found") {
      const signedUp = await fapi({
        frontendApi,
        fetchImpl,
        method: "POST",
        path: "/client/sign_ups",
        devBrowser,
        body: {
          strategy: "google_one_tap",
          token: idToken,
        },
      });
      return resolveGoogleOneTap(frontendApi, fetchImpl, signedUp, devBrowser);
    }
    throw error;
  }
}

export async function finishGoogleSignIn(options: {
  frontendApi: string;
  clientJwt: string;
  signInId: string;
  rotatingTokenNonce?: string;
  callbackUrl?: string;
  devBrowser?: string;
  fetchImpl?: typeof fetch;
}): Promise<ClerkAccount> {
  const frontendApi = clerkFrontendApi(options.frontendApi);
  const fetchImpl = options.fetchImpl ?? fetch;
  const nonce = options.rotatingTokenNonce?.trim() ?? "";
  const devBrowser = options.devBrowser?.trim() ?? "";
  if (!options.signInId.startsWith("sia_")) {
    throw new ClerkSignInError("the sign-in did not finish", "rejected");
  }
  const query = options.callbackUrl ? clerkCallbackQuery(options.callbackUrl) : {};
  if (nonce) query.rotating_token_nonce = nonce;

  const reloaded = await fapi({
    frontendApi,
    fetchImpl,
    method: "GET",
    path: `/client/sign_ins/${encodeURIComponent(options.signInId)}`,
    ...credential(options.clientJwt, devBrowser),
    query: Object.keys(query).length > 0 ? query : undefined,
  });
  const signedIn = accountFromBody(reloaded.body, reloaded.jwt, reloaded.devBrowser || devBrowser);
  if (signedIn) return signedIn;

  const response = record(record(reloaded.body)?.response);
  const verification = record(response?.first_factor_verification);
  if (verification?.status === "transferable") {
    const signedUp = await fapi({
      frontendApi,
      fetchImpl,
      method: "POST",
      path: "/client/sign_ups",
      ...credential(reloaded.jwt, reloaded.devBrowser || devBrowser),
      body: { transfer: "true" },
    });
    const created =
      accountFromBody(signedUp.body, signedUp.jwt, signedUp.devBrowser || devBrowser) ??
      (await readBodyAccount(frontendApi, fetchImpl, signedUp.jwt, signedUp.devBrowser || devBrowser));
    if (!created) throw new ClerkSignInError("could not read the Google account", "rejected");
    return created;
  }

  if (response?.status === "complete" || verification?.status === "verified") {
    const loaded = await readBodyAccount(frontendApi, fetchImpl, reloaded.jwt, reloaded.devBrowser || devBrowser);
    if (loaded) return loaded;
  }
  throw new ClerkSignInError(verificationMessage(verification) ?? unfinishedMessage(response, verification), "rejected");
}

/** The account on this client JWT, or an error when the session is gone or Clerk cannot be reached. */
export async function readClerkAccount(options: {
  frontendApi: string;
  clientJwt: string;
  devBrowser?: string;
  fetchImpl?: typeof fetch;
}): Promise<ClerkAccount> {
  const frontendApi = clerkFrontendApi(options.frontendApi);
  const fetchImpl = options.fetchImpl ?? fetch;
  const devBrowser = options.devBrowser?.trim() ?? "";
  const loaded = await fapi({
    frontendApi,
    fetchImpl,
    method: "GET",
    path: "/client",
    ...credential(options.clientJwt, devBrowser),
  });
  const account = accountFromBody(loaded.body, loaded.jwt || options.clientJwt, loaded.devBrowser || devBrowser);
  if (!account) throw new ClerkSignInError("not signed in", "signed-out");
  return account;
}

/** Ends the Clerk session. A network failure still lets the caller delete the local copy. */
export async function endClerkSession(options: {
  frontendApi: string;
  account: ClerkAccount;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const frontendApi = clerkFrontendApi(options.frontendApi);
  try {
    await fapi({
      frontendApi,
      fetchImpl: options.fetchImpl ?? fetch,
      method: "POST",
      path: `/client/sessions/${encodeURIComponent(options.account.sessionId)}/end`,
      ...credential(options.account.clientJwt, options.account.devBrowser ?? ""),
    });
  } catch (error) {
    if (error instanceof ClerkSignInError && error.code === "unreachable") return;
    if (error instanceof ClerkSignInError && error.code === "signed-out") return;
    if (error instanceof ClerkSignInError) return;
    throw error;
  }
}

interface FapiResult {
  jwt: string;
  devBrowser: string;
  body: unknown;
}

function credential(clientJwt: string, devBrowser: string): { auth?: string; devBrowser?: string } {
  if (devBrowser.startsWith("dvb_")) return { devBrowser };
  if (clientJwt.startsWith("eyJ")) return { auth: clientJwt };
  return {};
}

async function openDevBrowser(frontendApi: string, fetchImpl: typeof fetch): Promise<string> {
  const opened = await fapi({ frontendApi, fetchImpl, method: "POST", path: "/dev_browser" });
  const id = opened.devBrowser || devBrowserId(opened.body);
  if (!id.startsWith("dvb_")) throw new ClerkSignInError("could not start sign-in", "rejected");
  return id;
}

function devBrowserId(body: unknown): string {
  const id = record(body)?.id;
  return typeof id === "string" && id.startsWith("dvb_") ? id : "";
}

function withDevBrowser(url: string, devBrowser: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("__clerk_db_jwt")) parsed.searchParams.set("__clerk_db_jwt", devBrowser);
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fapi(options: {
  frontendApi: string;
  fetchImpl: typeof fetch;
  method: "GET" | "POST";
  path: string;
  auth?: string;
  devBrowser?: string;
  body?: Record<string, string>;
  query?: Record<string, string>;
}): Promise<FapiResult> {
  const params = new URLSearchParams({
    __clerk_api_version: FAPI_VERSION,
    _clerk_js_version: CLERK_JS_VERSION,
    ...options.query,
  });
  if (options.devBrowser) params.set("__clerk_db_jwt", options.devBrowser);
  const headers: Record<string, string> = {};
  if (!options.devBrowser && options.auth) headers.authorization = `Bearer ${options.auth}`;
  let body: string | undefined;
  if (options.body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.body).toString();
  }
  let response: Response;
  try {
    response = await options.fetchImpl(`https://${options.frontendApi}/v1${options.path}?${params}`, {
      method: options.method,
      headers,
      body,
    });
  } catch {
    throw new ClerkSignInError("could not reach Clerk", "unreachable");
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const signedOut = response.status === 401 || response.status === 403;
    throw new ClerkSignInError(
      safeMessage(parsed, signedOut ? "not signed in" : "could not sign in"),
      signedOut ? "signed-out" : "rejected",
      clerkApiErrorCode(parsed) ?? undefined,
    );
  }
  const next = jwtFromAuthorization(response.headers.get("authorization"));
  const jwt = next ?? (options.auth?.startsWith("eyJ") ? options.auth : "");
  const rotated = response.headers.get("clerk-db-jwt")?.trim() ?? "";
  const devBrowser = rotated.startsWith("dvb_") ? rotated : options.devBrowser?.startsWith("dvb_") ? options.devBrowser : "";
  return { jwt, devBrowser, body: parsed };
}

async function readBodyAccount(
  frontendApi: string,
  fetchImpl: typeof fetch,
  jwt: string,
  devBrowser: string,
): Promise<ClerkAccount | null> {
  const creds = credential(jwt, devBrowser);
  if (!creds.auth && !creds.devBrowser) return null;
  const loaded = await fapi({ frontendApi, fetchImpl, method: "GET", path: "/client", ...creds });
  return accountFromBody(loaded.body, loaded.jwt || jwt, loaded.devBrowser || devBrowser);
}

function accountFromBody(body: unknown, clientJwt: string, devBrowser: string): ClerkAccount | null {
  const jwt = clientJwt.startsWith("eyJ") ? clientJwt : "";
  const browser = devBrowser.startsWith("dvb_") ? devBrowser : "";
  if (!jwt && !browser) return null;
  const client = clientRecord(body);
  if (!client) return null;
  const sessions = Array.isArray(client.sessions) ? client.sessions : [];
  for (const session of sessions) {
    const account = accountFromSession(session, jwt, browser);
    if (account) return account;
  }
  return null;
}

function accountFromSession(session: unknown, clientJwt: string, devBrowser: string): ClerkAccount | null {
  const row = record(session);
  if (!row) return null;
  const sessionId = typeof row.id === "string" ? row.id : "";
  const user = record(row.user);
  const userId = typeof user?.id === "string" ? user.id : "";
  const email = emailFromUser(user) || identifierFrom(row);
  if (!sessionId.startsWith("sess_") || !userId.startsWith("user_") || !email.includes("@")) return null;
  return { clientJwt, ...(devBrowser ? { devBrowser } : {}), sessionId, userId, email };
}

function emailFromUser(user: Record<string, unknown> | null): string {
  if (!user) return "";
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  const primaryId = typeof user.primary_email_address_id === "string" ? user.primary_email_address_id : "";
  const primary = emails.find((item) => record(item)?.id === primaryId);
  return emailAddress(primary) || emailAddress(emails[0]);
}

function emailAddress(value: unknown): string {
  const row = record(value);
  return row && typeof row.email_address === "string" ? row.email_address : "";
}

function identifierFrom(session: Record<string, unknown>): string {
  const data = record(session.public_user_data);
  return typeof data?.identifier === "string" ? data.identifier : "";
}

function clientRecord(body: unknown): Record<string, unknown> | null {
  const root = record(body);
  if (!root) return null;
  const client = record(root.client);
  if (client && typeof client.id === "string" && client.id.startsWith("client_")) return client;
  const response = record(root.response);
  if (response && typeof response.id === "string" && response.id.startsWith("client_")) return response;
  return null;
}

function callbackParams(url: string): URLSearchParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const params = new URLSearchParams(parsed.searchParams);
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (!hash) return params;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash.includes("=") ? hash : "";
  const fromHash = new URLSearchParams(query);
  fromHash.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}

function unfinishedMessage(
  response: Record<string, unknown> | null,
  verification: Record<string, unknown> | null,
): string {
  const status = statusToken(response?.status);
  const verificationStatus = statusToken(verification?.status);
  const detail = [status, verificationStatus].filter(Boolean).join(", ");
  return detail ? `the sign-in did not finish (${detail})` : "the sign-in did not finish";
}

function statusToken(value: unknown): string {
  return typeof value === "string" && /^[a-z_]{1,40}$/u.test(value) ? value : "";
}

function verificationMessage(verification: Record<string, unknown> | null): string | null {
  const error = record(verification?.error);
  const message = typeof error?.long_message === "string" ? error.long_message : error?.message;
  return typeof message === "string" ? safeText(message, null) : null;
}

function safeMessage(body: unknown, fallback: string): string {
  const errors = record(body)?.errors;
  const first = Array.isArray(errors) ? record(errors[0]) : null;
  const message = typeof first?.long_message === "string" ? first.long_message : first?.message;
  if (typeof message !== "string") return fallback;
  return safeText(message, fallback) ?? fallback;
}

function clerkApiErrorCode(body: unknown): string | null {
  const errors = record(body)?.errors;
  const first = Array.isArray(errors) ? record(errors[0]) : null;
  const code = first?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

async function resolveGoogleOneTap(
  frontendApi: string,
  fetchImpl: typeof fetch,
  started: FapiResult,
  devBrowser: string,
): Promise<ClerkAccount> {
  const browser = started.devBrowser || devBrowser;
  const signedIn = accountFromBody(started.body, started.jwt, browser);
  if (signedIn) return signedIn;

  const response = record(record(started.body)?.response);
  const verification = record(response?.first_factor_verification);
  if (verification?.status === "transferable") {
    const signedUp = await fapi({
      frontendApi,
      fetchImpl,
      method: "POST",
      path: "/client/sign_ups",
      ...credential(started.jwt, browser),
      body: { transfer: "true" },
    });
    const created =
      accountFromBody(signedUp.body, signedUp.jwt, signedUp.devBrowser || browser) ??
      (await readBodyAccount(frontendApi, fetchImpl, signedUp.jwt, signedUp.devBrowser || browser));
    if (!created) throw new ClerkSignInError("could not read the Google account", "rejected");
    return created;
  }

  if (response?.status === "complete" || verification?.status === "verified") {
    const loaded = await readBodyAccount(frontendApi, fetchImpl, started.jwt, browser);
    if (loaded) return loaded;
  }
  throw new ClerkSignInError(verificationMessage(verification) ?? unfinishedMessage(response, verification), "rejected");
}

function safeText(message: string, fallback: string | null): string | null {
  const text = message.trim();
  if (!text || text.length > 240 || text.includes("eyJ")) return fallback;
  return text;
}

function jwtFromAuthorization(header: string | null): string | null {
  if (!header) return null;
  const value = header.replace(/^Bearer\s+/iu, "").trim();
  return value.startsWith("eyJ") ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
