import { describe, expect, test } from "bun:test";
import { DEVICE_JWT_AUDIENCE, DEVICE_JWT_KID, PENDING_BOT_CAP, tooManyPendingBots } from "@puck/shared";
import {
  DEVICE_ALREADY_CLAIMED,
  SETUP_CODE_ENV,
  SETUP_CODE_INVALID,
  SIGNING_KEY_ENV,
  UNAUTHORIZED,
  assertAuthorizedDevice,
  assertCanClaim,
  assertSetupCode,
  importSigningKey,
  publicJwk,
  signDeviceJwt,
  verifyDeviceJwt,
} from "../convex/lib/deviceAuth";

const ISSUER = "https://usable-mule-44.convex.site";
const NOW = 1_700_000_000;

async function keyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of pkcs8) binary += String.fromCharCode(byte);
  const stored = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  const privateKey = await importSigningKey(stored);
  const jwk = await publicJwk(privateKey);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return { privateKey, publicKey, jwk };
}

const device = { id: "dev_one", tokenId: "tid_one" };

describe("setup code", () => {
  test("rejects a wrong code and accepts the configured code", async () => {
    const previous = process.env[SETUP_CODE_ENV];
    process.env[SETUP_CODE_ENV] = "correct-horse";
    try {
      await expect(assertSetupCode("wrong-horse")).rejects.toThrow(SETUP_CODE_INVALID);
      await expect(assertSetupCode("")).rejects.toThrow(SETUP_CODE_INVALID);
      await expect(assertSetupCode("correct-horse")).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env[SETUP_CODE_ENV];
      else process.env[SETUP_CODE_ENV] = previous;
    }
  });

  test("fails closed when the setup code is not configured", async () => {
    const previous = process.env[SETUP_CODE_ENV];
    delete process.env[SETUP_CODE_ENV];
    try {
      await expect(assertSetupCode("correct-horse")).rejects.toThrow(/is not set/);
    } finally {
      if (previous !== undefined) process.env[SETUP_CODE_ENV] = previous;
    }
  });
});

describe("one device", () => {
  test("a second claim is rejected", () => {
    expect(() => assertCanClaim(false)).not.toThrow();
    expect(() => assertCanClaim(true)).toThrow(DEVICE_ALREADY_CLAIMED);
  });
});

describe("device token", () => {
  test("rejects a missing identity and accepts the claimed device", () => {
    expect(() => assertAuthorizedDevice(null, device, ISSUER)).toThrow(UNAUTHORIZED);
    expect(() =>
      assertAuthorizedDevice(
        { subject: "dev_other", issuer: ISSUER, tokenId: device.tokenId },
        device,
        ISSUER,
      ),
    ).toThrow(UNAUTHORIZED);
    expect(() =>
      assertAuthorizedDevice({ subject: device.id, issuer: ISSUER, tokenId: "tid_other" }, device, ISSUER),
    ).toThrow(UNAUTHORIZED);
    expect(() =>
      assertAuthorizedDevice(
        { subject: device.id, issuer: ISSUER, tokenId: device.tokenId },
        device,
        ISSUER,
      ),
    ).not.toThrow();
  });

  test("a signed token authorizes, and a tampered or foreign token does not", async () => {
    const { privateKey, publicKey, jwk } = await keyPair();
    expect(jwk.kid).toBe(DEVICE_JWT_KID);
    expect(jwk.alg).toBe("RS256");
    expect(jwk.d).toBeUndefined();
    expect(jwk.p).toBeUndefined();
    expect(jwk.q).toBeUndefined();
    expect(JSON.stringify(jwk)).not.toContain('"d"');

    const token = await signDeviceJwt(privateKey, {
      issuer: ISSUER,
      audience: DEVICE_JWT_AUDIENCE,
      deviceId: device.id,
      tokenId: device.tokenId,
      nowSeconds: NOW,
    });
    const expected = {
      issuer: ISSUER,
      audience: DEVICE_JWT_AUDIENCE,
      deviceId: device.id,
      tokenId: device.tokenId,
      nowSeconds: NOW + 10,
    };
    await expect(verifyDeviceJwt(token, publicKey, expected)).resolves.toBeUndefined();
    await expect(verifyDeviceJwt("", publicKey, expected)).rejects.toThrow(UNAUTHORIZED);
    const flipped = `${token.slice(0, -4)}${token.endsWith("aaaa") ? "bbbb" : "aaaa"}`;
    await expect(verifyDeviceJwt(flipped, publicKey, expected)).rejects.toThrow(UNAUTHORIZED);
    await expect(
      verifyDeviceJwt(token, publicKey, { ...expected, deviceId: "dev_other" }),
    ).rejects.toThrow(UNAUTHORIZED);
    await expect(
      verifyDeviceJwt(token, publicKey, { ...expected, nowSeconds: NOW + 180 * 24 * 60 * 60 + 120 }),
    ).rejects.toThrow(UNAUTHORIZED);

    const other = await keyPair();
    await expect(verifyDeviceJwt(token, other.publicKey, expected)).rejects.toThrow(UNAUTHORIZED);
  });

  test("refuses to import a signing key that is not configured", async () => {
    const previous = process.env[SIGNING_KEY_ENV];
    delete process.env[SIGNING_KEY_ENV];
    try {
      const { loadSigningKey } = await import("../convex/lib/deviceAuth");
      await expect(loadSigningKey()).rejects.toThrow(/is not set/);
    } finally {
      if (previous !== undefined) process.env[SIGNING_KEY_ENV] = previous;
    }
  });
});

describe("pending bots", () => {
  test("the cap is the shared limit", () => {
    expect(tooManyPendingBots(PENDING_BOT_CAP)).toBe(true);
    expect(PENDING_BOT_CAP).toBe(5);
  });
});
