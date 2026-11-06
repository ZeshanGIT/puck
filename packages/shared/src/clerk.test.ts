import { describe, expect, test } from "bun:test";
import {
  ClerkSignInError,
  ClerkTokenError,
  DEV_CLERK_FRONTEND_API,
  beginGoogleSignIn,
  clerkFrontendApi,
  clerkPublishableKey,
  endClerkSession,
  fetchConvexToken,
  callbackProblem,
  clerkCallbackQuery,
  finishGoogleSignIn,
  hasClerkReturn,
  nonceFromCallback,
  readClerkAccount,
  signInWithGoogleOneTap,
} from "./clerk";

const HOST = DEV_CLERK_FRONTEND_API;
const CLIENT_JWT = `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ id: "client_test" }))}.sig`;
const NEXT_JWT = `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ id: "client_next" }))}.sig`;

function json(body: unknown, status = 200, jwt?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(jwt ? { authorization: jwt } : {}),
    },
  });
}

function userBody(jwtNote: string) {
  return {
    response: {
      id: "sia_test",
      status: "complete",
      created_session_id: "sess_test",
    },
    client: {
      id: "client_test",
      sessions: [
        {
          id: "sess_test",
          user: {
            id: "user_test",
            primary_email_address_id: "idn_1",
            email_addresses: [
              { id: "idn_1", email_address: "seshan@example.com" },
              { id: "idn_2", email_address: "other@example.com" },
            ],
          },
        },
      ],
    },
    note: jwtNote,
  };
}

describe("clerk host", () => {
  test("the dev publishable key decodes to the Frontend API host", () => {
    const key = clerkPublishableKey(HOST);
    expect(key.startsWith("pk_test_")).toBe(true);
    const raw = key.slice("pk_test_".length);
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    expect(atob(padded)).toBe(`${HOST}$`);
    expect(clerkFrontendApi(`https://${HOST}/`)).toBe(HOST);
  });
});

describe("nonceFromCallback", () => {
  test("reads the nonce from the query or the hash", () => {
    expect(nonceFromCallback("puck://sso-callback?rotating_token_nonce=abc")).toBe("abc");
    expect(nonceFromCallback("http://127.0.0.1:9/callback?rotating_token_nonce=abc&x=1")).toBe("abc");
    expect(nonceFromCallback("http://localhost:9/callback#/sso-callback?rotating_token_nonce=from-hash")).toBe("from-hash");
    expect(nonceFromCallback("puck://sso-callback")).toBeNull();
    expect(nonceFromCallback("not a url")).toBeNull();
  });

  test("a denied Google redirect is a readable failure", () => {
    expect(callbackProblem("http://localhost:9/callback?__clerk_status=failed&__clerk_error_code=oauth_access_denied")).toBe(
      "You did not grant access to your account.",
    );
    expect(callbackProblem("http://localhost:9/callback?rotating_token_nonce=abc")).toBeNull();
  });

  test("a dev handshake counts as a return even without a nonce", () => {
    const url = "http://localhost:9/callback?__clerk_handshake=handshake-1";
    expect(hasClerkReturn(url)).toBe(true);
    expect(clerkCallbackQuery(url)).toEqual({ __clerk_handshake: "handshake-1" });
    expect(hasClerkReturn("http://localhost:9/callback")).toBe(false);
  });
});

describe("beginGoogleSignIn", () => {
  test("creates a dev browser, then starts Google without an Authorization header", async () => {
    const calls: { url: string; auth: string; body: string }[] = [];
    const attempt = await beginGoogleSignIn({
      frontendApi: HOST,
      redirectUrl: "puck://sso-callback",
      fetchImpl: async (url, init) => {
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        calls.push({ url: String(url), auth, body: String(init?.body ?? "") });
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/dev_browser")) return json({ id: "dvb_test" });
        return json(
          {
            response: {
              id: "sia_test",
              status: "needs_identifier",
              first_factor_verification: {
                status: "unverified",
                external_verification_redirect_url: "https://accounts.google.com/o/oauth2/auth?state=secret",
              },
            },
          },
          200,
          CLIENT_JWT,
        );
      },
    });
    expect(calls[0]?.auth).toBe("");
    expect(calls[0]?.url).toContain("/dev_browser");
    expect(calls[1]?.auth).toBe("");
    expect(calls[1]?.url).toContain("__clerk_db_jwt=dvb_test");
    expect(calls[1]?.url).toContain("__clerk_api_version=2026-08-20");
    expect(calls[1]?.body).toContain("strategy=oauth_google");
    expect(calls[1]?.body).toContain("redirect_url=puck%3A%2F%2Fsso-callback");
    expect(attempt.signInId).toBe("sia_test");
    expect(attempt.devBrowser).toBe("dvb_test");
    expect(attempt.verificationUrl).toContain("accounts.google.com");
    expect(new URL(attempt.verificationUrl).searchParams.get("__clerk_db_jwt")).toBe("dvb_test");
    expect(attempt.clientJwt).toBe(CLIENT_JWT);
  });
});

describe("finishGoogleSignIn", () => {
  test("reloads the sign-in with the nonce and reads the primary email", async () => {
    let nonceSent = "";
    const account = await finishGoogleSignIn({
      frontendApi: HOST,
      clientJwt: CLIENT_JWT,
      signInId: "sia_test",
      rotatingTokenNonce: "nonce-1",
      fetchImpl: async (url, init) => {
        nonceSent = new URL(String(url)).searchParams.get("rotating_token_nonce") ?? "";
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${CLIENT_JWT}`);
        return json(userBody("kept"), 200, NEXT_JWT);
      },
    });
    expect(nonceSent).toBe("nonce-1");
    expect(account).toEqual({
      clientJwt: NEXT_JWT,
      sessionId: "sess_test",
      userId: "user_test",
      email: "seshan@example.com",
    });
  });

  test("transfers a first-time Google account into a sign-up", async () => {
    const paths: string[] = [];
    const account = await finishGoogleSignIn({
      frontendApi: HOST,
      clientJwt: CLIENT_JWT,
      signInId: "sia_test",
      rotatingTokenNonce: "nonce-1",
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.includes("/sign_ins/")) {
          return json(
            {
              response: {
                id: "sia_test",
                first_factor_verification: { status: "transferable" },
              },
              client: { id: "client_test", sessions: [] },
            },
            200,
            CLIENT_JWT,
          );
        }
        expect(String(init?.body)).toBe("transfer=true");
        return json(userBody("created"), 200, NEXT_JWT);
      },
    });
    expect(paths.some((path) => path.includes("/sign_ups"))).toBe(true);
    expect(account.email).toBe("seshan@example.com");
    expect(account.clientJwt).toBe(NEXT_JWT);
  });

  test("reloads without a nonce when the redirect omitted one", async () => {
    let nonceSent: string | null = "unset";
    const account = await finishGoogleSignIn({
      frontendApi: HOST,
      clientJwt: CLIENT_JWT,
      signInId: "sia_test",
      fetchImpl: async (url) => {
        nonceSent = new URL(String(url)).searchParams.get("rotating_token_nonce");
        return json(userBody("kept"), 200, NEXT_JWT);
      },
    });
    expect(nonceSent).toBeNull();
    expect(account.email).toBe("seshan@example.com");
  });

  test("a dev browser is sent as a query param and not as Authorization", async () => {
    let auth = "unset";
    let browser = "";
    const account = await finishGoogleSignIn({
      frontendApi: HOST,
      clientJwt: "",
      signInId: "sia_test",
      devBrowser: "dvb_test",
      fetchImpl: async (url, init) => {
        auth = new Headers(init?.headers).get("authorization") ?? "";
        browser = new URL(String(url)).searchParams.get("__clerk_db_jwt") ?? "";
        return json(userBody("kept"), 200, "");
      },
    });
    expect(auth).toBe("");
    expect(browser).toBe("dvb_test");
    expect(account.devBrowser).toBe("dvb_test");
    expect(account.email).toBe("seshan@example.com");
  });

  test("forwards a dev handshake on the reload and does not put it in the error", async () => {
    let handshake = "";
    await finishGoogleSignIn({
      frontendApi: HOST,
      clientJwt: CLIENT_JWT,
      signInId: "sia_test",
      callbackUrl: "http://localhost:9/callback?__clerk_handshake=handshake-1",
      fetchImpl: async (url) => {
        handshake = new URL(String(url)).searchParams.get("__clerk_handshake") ?? "";
        return json(userBody("kept"), 200, NEXT_JWT);
      },
    });
    expect(handshake).toBe("handshake-1");
  });
});

describe("signInWithGoogleOneTap", () => {
  test("starts a dev browser and posts the Google ID token", async () => {
    const paths: string[] = [];
    const bodies: string[] = [];
    const account = await signInWithGoogleOneTap({
      frontendApi: HOST,
      idToken: "google-id-token",
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.endsWith("/dev_browser")) return json({ id: "dvb_test" }, 200);
        bodies.push(String(init?.body ?? ""));
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return json(userBody("native"), 200, NEXT_JWT);
      },
    });
    expect(paths.some((path) => path.endsWith("/sign_ins"))).toBe(true);
    expect(bodies.some((body) => body.includes("strategy=google_one_tap") && body.includes("token=google-id-token"))).toBe(
      true,
    );
    expect(account.email).toBe("seshan@example.com");
  });

  test("creates a sign-up when Clerk reports external_account_not_found", async () => {
    const paths: string[] = [];
    const account = await signInWithGoogleOneTap({
      frontendApi: HOST,
      idToken: "google-id-token",
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.endsWith("/dev_browser")) return json({ id: "dvb_test" }, 200);
        if (path.endsWith("/sign_ins")) {
          return json({ errors: [{ code: "external_account_not_found", message: "missing" }] }, 422);
        }
        return json(userBody("signed-up"), 200, NEXT_JWT);
      },
    });
    expect(paths.some((path) => path.endsWith("/sign_ups"))).toBe(true);
    expect(account.clientJwt).toBe(NEXT_JWT);
  });
});

describe("readClerkAccount", () => {
  test("a client with no session is signed out", async () => {
    await expect(
      readClerkAccount({
        frontendApi: HOST,
        clientJwt: CLIENT_JWT,
        fetchImpl: async () => json({ response: { id: "client_test", sessions: [] } }, 200, CLIENT_JWT),
      }),
    ).rejects.toMatchObject({ code: "signed-out" });
  });

  test("an unreachable Clerk is not treated as signed out", async () => {
    const error = await readClerkAccount({
      frontendApi: HOST,
      clientJwt: CLIENT_JWT,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClerkSignInError);
    expect(error).toMatchObject({ code: "unreachable", message: "could not reach Clerk" });
  });
});

describe("endClerkSession", () => {
  test("posts to the session end route and keeps a network failure local", async () => {
    const paths: string[] = [];
    await endClerkSession({
      frontendApi: HOST,
      account: {
        clientJwt: CLIENT_JWT,
        sessionId: "sess_test",
        userId: "user_test",
        email: "seshan@example.com",
      },
      fetchImpl: async (url) => {
        paths.push(new URL(String(url)).pathname);
        return json({}, 200);
      },
    });
    expect(paths).toEqual(["/v1/client/sessions/sess_test/end"]);
    await endClerkSession({
      frontendApi: HOST,
      account: {
        clientJwt: CLIENT_JWT,
        sessionId: "sess_test",
        userId: "user_test",
        email: "seshan@example.com",
      },
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
  });
});

describe("fetchConvexToken", () => {
  const account = { clientJwt: CLIENT_JWT, sessionId: "sess_test" };
  const TOKEN = `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ aud: "convex" }))}.sig`;

  test("posts to the convex template route and returns the jwt", async () => {
    let method = "";
    let path = "";
    let auth = "";
    const token = await fetchConvexToken({
      frontendApi: HOST,
      account,
      fetchImpl: async (url, init) => {
        method = String(init?.method);
        path = new URL(String(url)).pathname;
        auth = new Headers(init?.headers).get("authorization") ?? "";
        return json({ object: "token", jwt: TOKEN }, 200, NEXT_JWT);
      },
    });
    expect(token).toBe(TOKEN);
    expect(method).toBe("POST");
    expect(path).toBe("/v1/client/sessions/sess_test/tokens/convex");
    expect(auth).toBe(`Bearer ${CLIENT_JWT}`);
  });

  test("a dev browser goes in the query and not in Authorization", async () => {
    let auth = "unset";
    let browser = "";
    await fetchConvexToken({
      frontendApi: HOST,
      account: { ...account, devBrowser: "dvb_test" },
      fetchImpl: async (url, init) => {
        auth = new Headers(init?.headers).get("authorization") ?? "";
        browser = new URL(String(url)).searchParams.get("__clerk_db_jwt") ?? "";
        return json({ jwt: TOKEN }, 200);
      },
    });
    expect(auth).toBe("");
    expect(browser).toBe("dvb_test");
  });

  test("a 404 means the template is missing", async () => {
    const error = await fetchConvexToken({
      frontendApi: HOST,
      account,
      fetchImpl: async () => json({ errors: [{ code: "resource_not_found", message: "not found" }] }, 404),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClerkTokenError);
    expect(error).toMatchObject({ code: "template-missing", status: 404 });
  });

  test("a 401 means signed out", async () => {
    const error = await fetchConvexToken({
      frontendApi: HOST,
      account,
      fetchImpl: async () => json({ errors: [{ code: "authentication_invalid", message: "no" }] }, 401),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClerkTokenError);
    expect(error).toMatchObject({ code: "signed-out", status: 401 });
  });

  test("an unreachable Clerk is not signed out, and a bad body is rejected", async () => {
    const offline = await fetchConvexToken({
      frontendApi: HOST,
      account,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }).catch((caught: unknown) => caught);
    expect(offline).toMatchObject({ name: "ClerkTokenError", code: "unreachable" });
    const bad = await fetchConvexToken({
      frontendApi: HOST,
      account,
      fetchImpl: async () => json({ object: "token" }, 200),
    }).catch((caught: unknown) => caught);
    expect(bad).toMatchObject({ name: "ClerkTokenError", code: "rejected" });
  });

  test("a session id that is not a session is signed out without calling Clerk", async () => {
    let called = false;
    const error = await fetchConvexToken({
      frontendApi: HOST,
      account: { clientJwt: CLIENT_JWT, sessionId: "nope" },
      fetchImpl: async () => {
        called = true;
        return json({});
      },
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "signed-out" });
    expect(called).toBe(false);
  });
});
