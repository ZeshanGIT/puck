const REFRESH_MARGIN_MS = 60_000;

export class DeviceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceRequestError";
  }
}

export interface ClaimedDevice {
  deviceId: string;
  secret: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

/** Drop the Convex wrapper so the phone shows the server's sentence. */
export function readableError(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong";
  const message = error.message
    .replace(/^\[CONVEX[^\]]*\]\s*/u, "")
    .replace(/^Uncaught Error:\s*/u, "")
    .trim();
  return message || "Something went wrong";
}

/** `exp` from a JWT payload, in milliseconds. Invalid tokens return null. */
export function jwtExpiresAtMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };
    if (typeof json.exp !== "number" || !Number.isFinite(json.exp)) return null;
    return json.exp * 1000;
  } catch {
    return null;
  }
}

/**
 * `POST /device/claim`. The secret is returned once and must be stored on the phone.
 */
export async function claimDevice(
  siteUrl: string,
  setupCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimedDevice> {
  const code = setupCode.trim();
  if (!code) throw new DeviceRequestError("setup code is required");
  const response = await fetchImpl(`${siteUrl}/device/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ setupCode: code }),
  });
  return readClaim(response);
}

/**
 * Exchanges the device secret for a device JWT.
 * A successful token is reused until it is close to expiry, because each exchange
 * replaces the previous token id on the server.
 */
export function createTokenFetcher(options: {
  siteUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): (args: { forceRefreshToken: boolean }) => Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cached: TokenCache | null = null;
  let pending: Promise<string | null> | null = null;

  async function exchange(): Promise<string | null> {
    const response = await fetchImpl(`${options.siteUrl}/device/token`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.secret}` },
    });
    if (!response.ok) {
      cached = null;
      return null;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      cached = null;
      return null;
    }
    const token = isRecord(body) && typeof body.token === "string" ? body.token : "";
    if (!token) {
      cached = null;
      return null;
    }
    cached = { token, expiresAt: jwtExpiresAtMs(token) ?? now() + 60 * 60 * 1000 };
    return token;
  }

  return ({ forceRefreshToken }) => {
    const fresh = cached !== null && cached.expiresAt - now() > REFRESH_MARGIN_MS;
    if (!forceRefreshToken && fresh && cached) return Promise.resolve(cached.token);
    if (pending) return pending;
    pending = exchange().finally(() => {
      pending = null;
    });
    return pending;
  };
}

const tokenFetchers = new Map<string, ReturnType<typeof createTokenFetcher>>();

/** One exchanger per device secret, so a reload cannot mint two tokens at once. */
export function deviceTokenFetcher(siteUrl: string, secret: string): ReturnType<typeof createTokenFetcher> {
  const key = `${siteUrl}\0${secret}`;
  const existing = tokenFetchers.get(key);
  if (existing) return existing;
  const created = createTokenFetcher({ siteUrl, secret });
  tokenFetchers.set(key, created);
  return created;
}

async function readClaim(response: Response): Promise<ClaimedDevice> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : "could not claim this phone";
    throw new DeviceRequestError(message);
  }
  if (!isRecord(body) || typeof body.deviceId !== "string" || typeof body.secret !== "string") {
    throw new DeviceRequestError("could not claim this phone");
  }
  return { deviceId: body.deviceId, secret: body.secret };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return atob(padded);
}
