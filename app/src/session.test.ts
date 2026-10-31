import { describe, expect, test } from "bun:test";
import { claimDevice, createTokenFetcher, jwtExpiresAtMs, readableError } from "./session";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeJwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds })).replace(/=+$/u, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe("claimDevice", () => {
  test("posts the trimmed setup code and returns the secret", async () => {
    let sent = "";
    const claimed = await claimDevice("https://usable-mule-44.convex.site", "  code  ", async (_url, init) => {
      sent = String(init?.body);
      return jsonResponse({ deviceId: "dev_abc", secret: "secret-value" }, 200);
    });
    expect(sent).toBe(JSON.stringify({ setupCode: "code" }));
    expect(claimed).toEqual({ deviceId: "dev_abc", secret: "secret-value" });
  });

  test("uses the server error", async () => {
    await expect(
      claimDevice("https://usable-mule-44.convex.site", "nope", async () =>
        jsonResponse({ error: "setup code is not valid" }, 401),
      ),
    ).rejects.toThrow("setup code is not valid");
  });
});

describe("createTokenFetcher", () => {
  test("reuses a fresh token and refreshes when asked", async () => {
    const token = fakeJwt(2_000_000_000);
    let calls = 0;
    const fetchToken = createTokenFetcher({
      siteUrl: "https://usable-mule-44.convex.site",
      secret: "device-secret",
      now: () => 1_700_000_000_000,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ token }, 200);
      },
    });
    expect(await fetchToken({ forceRefreshToken: false })).toBe(token);
    expect(await fetchToken({ forceRefreshToken: false })).toBe(token);
    expect(calls).toBe(1);
    expect(await fetchToken({ forceRefreshToken: true })).toBe(token);
    expect(calls).toBe(2);
  });

  test("a rejected secret clears the cache", async () => {
    const fetchToken = createTokenFetcher({
      siteUrl: "https://usable-mule-44.convex.site",
      secret: "device-secret",
      fetchImpl: async () => jsonResponse({ error: "unauthorized" }, 401),
    });
    expect(await fetchToken({ forceRefreshToken: false })).toBeNull();
    expect(await fetchToken({ forceRefreshToken: true })).toBeNull();
  });
});

describe("jwtExpiresAtMs", () => {
  test("reads exp", () => {
    expect(jwtExpiresAtMs(fakeJwt(100))).toBe(100_000);
    expect(jwtExpiresAtMs("not-a-jwt")).toBeNull();
  });
});

describe("readableError", () => {
  test("strips the Convex wrapper", () => {
    expect(readableError(new Error("[CONVEX M(bots:approvePairing)] Uncaught Error: pairing code is not valid"))).toBe(
      "pairing code is not valid",
    );
  });
});
