// One-device JWT. The private key stays in PUCK_DEVICE_SIGNING_KEY.
// The setup code stays in PUCK_DEVICE_SETUP_CODE. Neither value is logged.

import { DEVICE_JWT_KID, DEVICE_TOKEN_TTL_SECONDS } from "@puck/shared";
import { hashSecret, timingSafeEqual } from "./crypto";

export const SETUP_CODE_ENV = "PUCK_DEVICE_SETUP_CODE";
export const SIGNING_KEY_ENV = "PUCK_DEVICE_SIGNING_KEY";
export const ISSUER_ENV = "PUCK_JWT_ISSUER";

export const UNAUTHORIZED = "unauthorized";
export const SETUP_CODE_INVALID = "setup code is not valid";
export const DEVICE_ALREADY_CLAIMED = "a device is already claimed";
export const TOO_MANY_PENDING_BOTS = "too many pending bots";

const SETUP_CODE_MAX = 256;
const CLOCK_SKEW_SECONDS = 30;

export class DeviceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceAuthError";
  }
}

function readEnv(name: string): string | undefined {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const value = runtime.process?.env?.[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Issuer for both the JWT `iss` claim and `auth.config.ts`. No trailing slash. */
export function deviceJwtIssuer(): string {
  const raw = readEnv("CONVEX_SITE_URL") ?? readEnv(ISSUER_ENV);
  const issuer = raw?.replace(/\/+$/u, "") ?? "";
  if (!issuer) throw new DeviceAuthError("CONVEX_SITE_URL or PUCK_JWT_ISSUER is not set");
  return issuer;
}

export function assertCanClaim(alreadyClaimed: boolean): void {
  if (alreadyClaimed) throw new DeviceAuthError(DEVICE_ALREADY_CLAIMED);
}

/** Compare a setup code with the env value. Wrong and missing codes share one error. */
export async function assertSetupCode(provided: string): Promise<void> {
  const candidate = provided.length > SETUP_CODE_MAX ? "" : provided.trim();
  await assertSetupCodeHash(await hashSecret(candidate));
}

/**
 * Compare a SHA-256 hex digest of a setup code with the env value.
 * The HTTP claim route hashes the code before the mutation, so the code
 * itself is never a mutation argument and does not land in Convex logs.
 */
export async function assertSetupCodeHash(providedHash: string): Promise<void> {
  const expected = readEnv(SETUP_CODE_ENV);
  if (!expected) throw new DeviceAuthError(`${SETUP_CODE_ENV} is not set`);
  const right = await hashSecret(expected);
  const left = /^[0-9a-f]{64}$/u.test(providedHash) ? providedHash : "0".repeat(64);
  if (!timingSafeEqual(left, right)) throw new DeviceAuthError(SETUP_CODE_INVALID);
}

/** URL-safe random token. For HTTP actions only: mutations must not call `getRandomValues`. */
export function randomToken(prefix: string, byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${encodeBase64Url(bytes)}`;
}

export type DeviceRecord = {
  id: string;
  tokenId: string;
};

/**
 * What a Convex identity must show before a mutation runs.
 * `tokenId` is the `token_id` claim. It matches the row so a replaced token dies.
 */
export function assertAuthorizedDevice(
  identity: { subject?: string | null; issuer?: string | null; tokenId?: string | null } | null,
  device: DeviceRecord | null,
  issuer: string,
): void {
  if (!identity?.subject || !device) throw new DeviceAuthError(UNAUTHORIZED);
  if (identity.subject !== device.id) throw new DeviceAuthError(UNAUTHORIZED);
  if (!identity.tokenId || identity.tokenId !== device.tokenId) throw new DeviceAuthError(UNAUTHORIZED);
  const gotIssuer = identity.issuer?.replace(/\/+$/u, "") ?? "";
  if (gotIssuer !== issuer) throw new DeviceAuthError(UNAUTHORIZED);
}

type JwtClaims = {
  issuer: string;
  audience: string;
  deviceId: string;
  tokenId: string;
  nowSeconds: number;
  ttlSeconds?: number;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  let binary: string;
  try {
    binary = atob(normalized + pad);
  } catch {
    throw new DeviceAuthError(UNAUTHORIZED);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeJson(value: object): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function importSigningKey(pkcs8Base64: string): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(pkcs8Base64.trim());
  } catch {
    throw new DeviceAuthError("signing key is not valid");
  }
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      copyBytes(bytes),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["sign"],
    );
  } catch {
    throw new DeviceAuthError("signing key is not valid");
  }
}

export async function loadSigningKey(): Promise<CryptoKey> {
  const raw = readEnv(SIGNING_KEY_ENV);
  if (!raw) throw new DeviceAuthError(`${SIGNING_KEY_ENV} is not set`);
  return importSigningKey(raw);
}

export type PublicRsaJwk = {
  kty: "RSA";
  n: string;
  e: string;
  alg: "RS256";
  use: "sig";
  kid: string;
};

/** Public JWK only. Private RSA fields (`d`, `p`, `q`, and the rest) are dropped. */
export async function publicJwk(privateKey: CryptoKey): Promise<PublicRsaJwk> {
  const full = await crypto.subtle.exportKey("jwk", privateKey);
  if (full.kty !== "RSA" || !full.n || !full.e) throw new DeviceAuthError("signing key is not valid");
  return {
    kty: "RSA",
    n: full.n,
    e: full.e,
    alg: "RS256",
    use: "sig",
    kid: DEVICE_JWT_KID,
  };
}

export async function publicJwks(): Promise<{ keys: PublicRsaJwk[] }> {
  const key = await loadSigningKey();
  return { keys: [await publicJwk(key)] };
}

export async function signDeviceJwt(privateKey: CryptoKey, claims: JwtClaims): Promise<string> {
  const ttl = claims.ttlSeconds ?? DEVICE_TOKEN_TTL_SECONDS;
  const header = { alg: "RS256", typ: "JWT", kid: DEVICE_JWT_KID };
  const payload = {
    iss: claims.issuer,
    aud: claims.audience,
    sub: claims.deviceId,
    iat: claims.nowSeconds,
    exp: claims.nowSeconds + ttl,
    token_id: claims.tokenId,
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function decodePart(part: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(part)));
  } catch (error) {
    if (error instanceof DeviceAuthError) throw error;
    throw new DeviceAuthError(UNAUTHORIZED);
  }
}

/**
 * Check an RS256 device token against the public key and the stored device.
 * The algorithm is fixed: the header does not choose it.
 */
export async function verifyDeviceJwt(
  token: string,
  publicKey: CryptoKey,
  expected: {
    issuer: string;
    audience: string;
    deviceId: string;
    tokenId: string;
    nowSeconds: number;
  },
): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new DeviceAuthError(UNAUTHORIZED);
  }
  const header = decodePart(parts[0]);
  if (!isRecord(header) || header.alg !== "RS256" || header.kid !== DEVICE_JWT_KID) {
    throw new DeviceAuthError(UNAUTHORIZED);
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  let signature: Uint8Array;
  try {
    signature = decodeBase64Url(parts[2]);
  } catch {
    throw new DeviceAuthError(UNAUTHORIZED);
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    copyBytes(signature),
    new TextEncoder().encode(signingInput),
  );
  if (!valid) throw new DeviceAuthError(UNAUTHORIZED);

  const payload = decodePart(parts[1]);
  if (!isRecord(payload)) throw new DeviceAuthError(UNAUTHORIZED);
  if (payload.iss !== expected.issuer) throw new DeviceAuthError(UNAUTHORIZED);
  if (payload.aud !== expected.audience) throw new DeviceAuthError(UNAUTHORIZED);
  if (payload.sub !== expected.deviceId) throw new DeviceAuthError(UNAUTHORIZED);
  if (payload.token_id !== expected.tokenId) throw new DeviceAuthError(UNAUTHORIZED);
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < expected.nowSeconds) {
    throw new DeviceAuthError(UNAUTHORIZED);
  }
  if (typeof payload.iat !== "number" || payload.iat > expected.nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new DeviceAuthError(UNAUTHORIZED);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
