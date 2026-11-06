// Live check of the clients functions against the dev deployment, as the CLI's Clerk user.
// Reads the Clerk session from ~/.config/puck/session.json and gets a Convex token with fetchConvexToken.
// Prints pass/fail lines only. The session file, the Clerk token and push tokens are never printed.
// Run after `convex deploy` of clients.ts: bun backend/scripts/smoke-clients.ts

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server";
import { ClerkTokenError, DEV_CLERK_FRONTEND_API, fetchConvexToken, type ClerkAccount } from "@puck/shared";

const backend = join(import.meta.dir, "..");
const secrets: string[] = [];
const PREFIX = "smokeclient";

function remember(value: string | undefined): void {
  if (value && value.length >= 8) secrets.push(value);
}

function safe(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

function textOf(error: unknown): string {
  return safe(error instanceof Error ? error.message : String(error));
}

function readDotEnv(name: string): string {
  const text = readFileSync(join(backend, ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim();
  }
  throw new Error(`missing ${name}`);
}

function readAccount(): ClerkAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(homedir(), ".config", "puck", "session.json"), "utf8"));
  } catch {
    throw new Error("no CLI session: run `puck login` first");
  }
  const row = parsed as Partial<ClerkAccount> | null;
  if (!row || typeof row.clientJwt !== "string" || typeof row.sessionId !== "string") {
    throw new Error("the CLI session file is not valid: run `puck login` again");
  }
  remember(row.clientJwt);
  remember(row.devBrowser);
  return row as ClerkAccount;
}

function ref(kind: "query", name: string): FunctionReference<"query">;
function ref(kind: "mutation", name: string): FunctionReference<"mutation">;
function ref(_kind: "query" | "mutation", name: string): FunctionReference<"query" | "mutation"> {
  const found = anyApi.clients?.[name];
  if (!found) throw new Error(`convex client is missing clients.${name}`);
  return found;
}

type Row = { id: string; name: string; platform: string; lastSeenAt: number; createdAt: number; [key: string]: unknown };
type Registered = { status: string; clientId: string };

async function expectFail(label: string, run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = textOf(error);
    if (!pattern.test(message)) {
      console.error(`fail ${label}: ${message}`);
      throw new Error(`${label} failed with an unexpected error`);
    }
    console.log(`pass ${label}`);
    return;
  }
  throw new Error(`${label} succeeded and should have failed`);
}

function check(label: string, ok: boolean): void {
  if (!ok) throw new Error(`fail ${label}`);
  console.log(`pass ${label}`);
}

const url = readDotEnv("CONVEX_URL");
const created: string[] = [];
let authed: ConvexHttpClient | null = null;

async function cleanup(client: ConvexHttpClient): Promise<number> {
  const rows = (await client.query(ref("query", "list"), {})) as Row[];
  let removed = 0;
  for (const row of rows.filter((item) => item.name.startsWith(PREFIX))) {
    await client.mutation(ref("mutation", "remove"), { clientId: row.id });
    removed++;
  }
  return removed;
}

try {
  const account = readAccount();
  let token: string;
  try {
    token = await fetchConvexToken({ frontendApi: DEV_CLERK_FRONTEND_API, account });
  } catch (error) {
    if (error instanceof ClerkTokenError && error.code === "template-missing") {
      throw new Error("Clerk has no JWT template named convex (create it in the Clerk dashboard)");
    }
    if (error instanceof ClerkTokenError && error.code === "signed-out") {
      throw new Error("the CLI session is signed out: run `puck login` again");
    }
    throw error;
  }
  remember(token);
  console.log("pass got a Convex token from Clerk");

  const anon = new ConvexHttpClient(url);
  await expectFail("clients.list with no token", () => anon.query(ref("query", "list"), {}), /unauthorized/);
  await expectFail(
    "clients.register with no token",
    () => anon.mutation(ref("mutation", "register"), { name: `${PREFIX}0`, platform: "cli" }),
    /unauthorized/,
  );

  const client = new ConvexHttpClient(url);
  client.setAuth(token);
  authed = client;

  const removedBefore = await cleanup(client);
  console.log(`pass cleared ${removedBefore} stale smoke clients`);

  const register = (name: string, extra: Record<string, unknown> = {}) =>
    client.mutation(ref("mutation", "register"), { name, platform: "cli", ...extra }) as Promise<Registered>;

  const name = `${PREFIX}-main`;
  const first = await register(name);
  created.push(first.clientId);
  check("register creates", first.status === "created" && first.clientId.length > 0);

  const again = await register(name);
  check("same name without replace reports exists with the same id", again.status === "exists" && again.clientId === first.clientId);

  const fakeToken = "smoke-push-token-0123456789abcdef";
  remember(fakeToken);
  await client.mutation(ref("mutation", "setPushToken"), { clientId: first.clientId, token: fakeToken });
  await expectFail(
    "setPushToken rejects a bad token",
    () => client.mutation(ref("mutation", "setPushToken"), { clientId: first.clientId, token: "short" }),
    /push token is not valid/,
  );

  const replaced = await register(name, { replace: true });
  check("replace keeps the row id", replaced.status === "replaced" && replaced.clientId === first.clientId);

  await client.mutation(ref("mutation", "setFlags"), { clientId: first.clientId, fullScreenAllowed: true, dndAccess: false });
  await client.mutation(ref("mutation", "touch"), { clientId: first.clientId });

  await expectFail("register rejects a two-line name", () => register(`${PREFIX}\nx`), /name must be/);
  await expectFail("register rejects a 41 character name", () => register(`${PREFIX}`.padEnd(41, "x")), /name must be/);

  const renamed = `${PREFIX}-renamed`;
  await client.mutation(ref("mutation", "rename"), { clientId: first.clientId, name: renamed });
  const second = await register(`${PREFIX}-second`);
  created.push(second.clientId);
  await expectFail(
    "rename to a name that is taken",
    () => client.mutation(ref("mutation", "rename"), { clientId: second.clientId, name: renamed }),
    /already exists/,
  );

  const rows = (await client.query(ref("query", "list"), {})) as Row[];
  const mine = rows.find((row) => row.id === first.clientId);
  check("list returns the renamed client with its flags", mine?.name === renamed && mine.fullScreenAllowed === true && mine.dndAccess === false);
  check("list never returns a push token", !JSON.stringify(rows).includes("pushToken") && !JSON.stringify(rows).includes(fakeToken));

  // Fill the list to the cap of 10, then one more must fail.
  let capped = false;
  for (let i = 0; i < 12 && !capped; i++) {
    try {
      const extra = await register(`${PREFIX}-fill${i}`);
      created.push(extra.clientId);
    } catch (error) {
      if (!/too many clients/.test(textOf(error))) throw error;
      capped = true;
    }
  }
  check("the 11th client is refused", capped);

  console.log("smoke ok");
} catch (error) {
  process.exitCode = 1;
  console.error(textOf(error));
} finally {
  if (authed) {
    try {
      await cleanup(authed);
      const left = ((await authed.query(ref("query", "list"), {})) as Row[]).filter((row) => row.name.startsWith(PREFIX));
      if (left.length > 0) throw new Error(`${left.length} smoke clients remain`);
      console.log("pass cleanup smokeClients=0");
    } catch (error) {
      process.exitCode = 1;
      console.error(textOf(error));
    }
  }
}
