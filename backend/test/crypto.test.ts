import { describe, expect, test } from "bun:test";
import {
  ENCRYPTION_ENV,
  decryptHeader,
  encryptHeader,
  hashSecret,
  newSecret,
  timingSafeEqual,
} from "../convex/lib/crypto";

const TEST_KEY = btoa("0123456789abcdef0123456789abcdef");

describe("hashSecret", () => {
  test("matches the SHA-256 test vector for abc", async () => {
    expect(await hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("compares digests without treating a different length as equal", () => {
    expect(timingSafeEqual("aa", "aa")).toBe(true);
    expect(timingSafeEqual("aa", "ab")).toBe(false);
    expect(timingSafeEqual("aa", "aaa")).toBe(false);
  });
});

describe("webhook header encryption", () => {
  test("round-trips the Authorization header and rejects a tampered value", async () => {
    const previous = process.env[ENCRYPTION_ENV];
    process.env[ENCRYPTION_ENV] = TEST_KEY;
    try {
      const stored = await encryptHeader("Bearer routine-key");
      expect(stored.startsWith("v1.")).toBe(true);
      expect(stored).not.toContain("routine-key");
      expect(await decryptHeader(stored)).toBe("Bearer routine-key");
      expect(await encryptHeader("Bearer routine-key")).not.toBe(stored);
      const parts = stored.split(".");
      const cipher = parts[2] ?? "";
      const flipped = `${cipher.startsWith("A") ? "B" : "A"}${cipher.slice(1)}`;
      const tampered = `${parts[0]}.${parts[1]}.${flipped}`;
      await expect(decryptHeader(tampered)).rejects.toThrow(/decrypt/);
    } finally {
      if (previous === undefined) delete process.env[ENCRYPTION_ENV];
      else process.env[ENCRYPTION_ENV] = previous;
    }
  });

  test("refuses to encrypt when the key is missing", async () => {
    const previous = process.env[ENCRYPTION_ENV];
    delete process.env[ENCRYPTION_ENV];
    try {
      await expect(encryptHeader("Bearer x")).rejects.toThrow(/is not set/);
    } finally {
      if (previous !== undefined) process.env[ENCRYPTION_ENV] = previous;
    }
  });
});

describe("newSecret", () => {
  test("returns a url-safe token", () => {
    const secret = newSecret();
    expect(secret.length).toBeGreaterThan(20);
    expect(secret).not.toContain("+");
    expect(secret).not.toContain("/");
  });
});
