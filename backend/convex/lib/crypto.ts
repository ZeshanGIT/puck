// Web Crypto only. Convex mutations may use Math.random (it is seeded) and
// crypto.subtle. getRandomValues is not used here, so a retried mutation
// still derives the same bytes.

import { questionIdFromBytes } from "@puck/shared";

export const ENCRYPTION_ENV = "PUCK_ENCRYPTION_KEY";

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

/** Uniform byte from Convex's seeded Math.random, safe inside a mutation. */
export function mutationRandomByte(): number {
  const limit = Math.floor(0x1_0000_0000 / 256) * 256;
  let value = Math.floor(Math.random() * 0x1_0000_0000);
  while (value >= limit) {
    value = Math.floor(Math.random() * 0x1_0000_0000);
  }
  return value % 256;
}

export function mutationRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  let value = Math.floor(Math.random() * 0x1_0000_0000);
  while (value >= limit) {
    value = Math.floor(Math.random() * 0x1_0000_0000);
  }
  return value % maxExclusive;
}

export function newQuestionId(): string {
  return questionIdFromBytes(mutationRandomByte);
}

export function newSecret(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = mutationRandomByte();
  return encodeBase64Url(bytes);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  let binary: string;
  try {
    binary = atob(normalized + pad);
  } catch {
    throw new CryptoError("invalid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compare two hex digests without stopping at the first difference. */
export function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}

function readEnv(name: string): string | undefined {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.[name];
}

function encryptionKey(): Uint8Array {
  const raw = readEnv(ENCRYPTION_ENV);
  if (!raw) throw new CryptoError(`${ENCRYPTION_ENV} is not set`);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(raw.trim());
  } catch {
    throw new CryptoError(`${ENCRYPTION_ENV} must be 32 bytes of base64`);
  }
  if (bytes.length !== 32) throw new CryptoError(`${ENCRYPTION_ENV} must be 32 bytes of base64`);
  return bytes;
}

async function importKey(usages: KeyUsage[]): Promise<CryptoKey> {
  // Copy into a fresh ArrayBuffer. A Uint8Array view can sit on a shared
  // buffer, which Web Crypto's BufferSource type rejects.
  const raw = encryptionKey();
  const buffer = new ArrayBuffer(raw.byteLength);
  new Uint8Array(buffer).set(raw);
  return crypto.subtle.importKey("raw", buffer, { name: "AES-GCM" }, false, usages);
}

/** Encrypt the webhook Authorization header. The plaintext is never stored. */
export async function encryptHeader(plaintext: string): Promise<string> {
  const iv = new Uint8Array(12);
  for (let i = 0; i < iv.length; i++) iv[i] = mutationRandomByte();
  const key = await importKey(["encrypt"]);
  const ivBuffer = new ArrayBuffer(iv.byteLength);
  new Uint8Array(ivBuffer).set(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptHeader(stored: string): Promise<string> {
  const [version, ivPart, cipherPart, extra] = stored.split(".");
  if (version !== "v1" || !ivPart || !cipherPart || extra !== undefined) {
    throw new CryptoError("webhook header ciphertext is not valid");
  }
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = decodeBase64(ivPart);
    ciphertext = decodeBase64(cipherPart);
  } catch (error) {
    if (error instanceof CryptoError) throw new CryptoError("could not decrypt the webhook header");
    throw error;
  }
  const key = await importKey(["decrypt"]);
  const ivBuffer = new ArrayBuffer(iv.byteLength);
  new Uint8Array(ivBuffer).set(iv);
  const cipherBuffer = new ArrayBuffer(ciphertext.byteLength);
  new Uint8Array(cipherBuffer).set(ciphertext);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
      key,
      cipherBuffer,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new CryptoError("could not decrypt the webhook header");
  }
}
