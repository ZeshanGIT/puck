import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clerkPublishableKey, DEV_CLERK_FRONTEND_API, type ClerkAccount } from "@puck/shared";
import { login, logout, readSession, runClerkLogin, whoami, writeSession } from "./account";
import { callbackBridgeHtml, loginPageHtml } from "./loginPage";
import { createProgram } from "./program";
import type { Runtime } from "./commands";

const HOST = DEV_CLERK_FRONTEND_API;
const CLIENT_JWT = `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ id: "client_test" }))}.sig`;

function json(body: unknown, status = 200, jwt?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(jwt ? { authorization: jwt } : {}) },
  });
}

function signedInBody() {
  return {
    response: { id: "sia_test", status: "complete" },
    client: {
      id: "client_test",
      sessions: [
        {
          id: "sess_test",
          user: {
            id: "user_test",
            primary_email_address_id: "idn_1",
            email_addresses: [{ id: "idn_1", email_address: "seshan@example.com" }],
          },
        },
      ],
    },
  };
}

function clerkFetch(): typeof fetch {
  return (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/dev_browser")) return json({ id: "dvb_test" });
    if (path.endsWith("/client") && init?.method === "POST") return json({ response: { id: "client_test" } }, 200, CLIENT_JWT);
    if (path.endsWith("/sign_ins")) {
      return json(
        {
          response: {
            id: "sia_test",
            first_factor_verification: {
              external_verification_redirect_url: "https://accounts.google.com/o/oauth2/auth?state=secret-state",
            },
          },
        },
        200,
        CLIENT_JWT,
      );
    }
    if (path.includes("/sign_ins/")) return json(signedInBody(), 200, CLIENT_JWT);
    if (path.endsWith("/client")) return json(signedInBody(), 200, CLIENT_JWT);
    if (path.endsWith("/end")) return json({}, 200);
    return json({ errors: [{ message: "unexpected" }] }, 404);
  }) as typeof fetch;
}

describe("login page", () => {
  test("the page offers Google and does not embed the client credential", () => {
    const html = loginPageHtml("https://accounts.google.com/o/oauth2/auth?state=secret-state</script>");
    expect(html).toContain("Continue with Google");
    expect(html).toContain("accounts.google.com");
    expect(html).not.toContain("</script><script>");
    expect(html).not.toContain(CLIENT_JWT);
  });
});

describe("session file", () => {
  test("login writes mode 0600 and whoami prints the email, never the client credential", async () => {
    const dir = await mkdtemp(join(tmpdir(), "puck-login-"));
    const lines: string[] = [];
    try {
      const account = await runClerkLogin({
        frontendApi: HOST,
        timeoutMs: 2000,
        fetchImpl: clerkFetch(),
        open: (url) => {
          void (async () => {
            const page = await fetch(url);
            const html = await page.text();
            expect(html).toContain("Continue with Google");
            expect(html).not.toContain(CLIENT_JWT);
            await fetch(new URL("/callback?rotating_token_nonce=nonce-1", url));
          })();
        },
      });
      expect(account.email).toBe("seshan@example.com");
      await writeSession(dir, account);
      const mode = (await stat(join(dir, "session.json"))).mode & 0o777;
      expect(mode).toBe(0o600);
      const text = await whoami(dir, {}, clerkFetch());
      expect(text).toBe("seshan@example.com\nuser_test\n");
      expect(text).not.toContain(CLIENT_JWT);
      lines.push(await logout(dir, {}, clerkFetch()));
      expect(lines[0]).toBe("signed out\n");
      expect(await readSession(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("whoami without a session says not signed in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "puck-login-"));
    try {
      await expect(whoami(dir, {})).rejects.toThrow("not signed in");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("login command", () => {
  test("help lists login, whoami and logout", () => {
    const runtime: Runtime = {
      env: {},
      configDir: "/tmp/unused",
      stdout: () => {},
      prompt: async () => {
        throw new Error("prompted");
      },
      backend: {
        pairingStatus: async () => "paired" as const,
        createPairing: async () => {
          throw new Error("backend");
        },
        postStatus: async () => {
          throw new Error("not used");
        },
        postAlert: async () => {
          throw new Error("backend");
        },
        listAlerts: async () => {
          throw new Error("backend");
        },
        cancelAlert: async () => {
          throw new Error("backend");
        },
      },
    };
    const names = createProgram(runtime).commands.map((command) => command.name());
    expect(names).toContain("login");
    expect(names).toContain("whoami");
    expect(names).toContain("logout");
    expect(clerkPublishableKey(HOST).startsWith("pk_test_")).toBe(true);
  });
});

describe("callback without a query nonce", () => {
  test("posts the full address, including a hash, before finishing", async () => {
    const account = await runClerkLogin({
      frontendApi: HOST,
      timeoutMs: 2000,
      fetchImpl: clerkFetch(),
      open: (url) => {
        void (async () => {
          const waiting = await fetch(new URL("/callback", url));
          const html = await waiting.text();
          expect(html).toContain("Finishing sign-in");
          expect(callbackBridgeHtml()).toContain("location.href");
          const posted = await fetch(new URL("/callback", url), {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: `${new URL("/callback", url).toString()}#rotating_token_nonce=nonce-1`,
          });
          expect(posted.status).toBe(200);
        })();
      },
    });
    expect(account.email).toBe("seshan@example.com");
  });

  test("a dev handshake in the query finishes without a nonce", async () => {
    const account = await runClerkLogin({
      frontendApi: HOST,
      timeoutMs: 2000,
      fetchImpl: clerkFetch(),
      open: (url) => {
        void fetch(new URL("/callback?__clerk_handshake=handshake-1", url));
      },
    });
    expect(account.email).toBe("seshan@example.com");
  });
});

describe("login wrapper", () => {
  test("stores the account from a finished browser callback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "puck-login-"));
    try {
      const text = await login(dir, {}, (url) => {
        void fetch(new URL("/callback?rotating_token_nonce=nonce-1", url));
      }, clerkFetch());
      expect(text).toBe("seshan@example.com\nuser_test\n");
      const stored = await readSession(dir);
      expect(stored?.email).toBe("seshan@example.com");
      expect(stored?.clientJwt).toBe(CLIENT_JWT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
