import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Backend, PairingStatus } from "./backend";
import { CliError } from "./errors";
import { addBot, machineName, waitForApproval, type Runtime } from "./commands";
import { readBotKey } from "./keyfile";

const SECRET = "bot-secret-do-not-print";
const HEADER = "Bearer header-do-not-print";
const ENV = { PUCK_WEBHOOK_URL: "https://example.com/hook", PUCK_WEBHOOK_HEADER: HEADER };

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "puck-pair-"));
  await writeFile(join(dir, "config.json"), JSON.stringify({ deploymentUrl: "https://example.convex.cloud" }), "utf8");
  return dir;
}

/** A backend whose pairing status walks through `statuses`, then repeats the last one. */
function fakeBackend(statuses: PairingStatus[], seen: { colour?: string; addedFrom?: string; token?: string | null } = {}): Backend {
  let index = 0;
  return {
    async createPairing(_url, input, token) {
      seen.colour = input.colour;
      seen.addedFrom = input.addedFrom;
      seen.token = token;
      return { botId: "cortana-12345", secret: SECRET, pairingCode: "042815" };
    },
    async updateWebhook() {},
    async pairingStatus() {
      const status = statuses[Math.min(index, statuses.length - 1)] ?? "pending";
      index += 1;
      return status;
    },
    async postStatus() {
      throw new Error("not used");
    },
    async postAlert() {
      throw new Error("not used");
    },
    async listAlerts() {
      throw new Error("not used");
    },
    async cancelAlert() {
      throw new Error("not used");
    },
  };
}

function runtime(dir: string, backend: Backend, extra: Partial<Runtime> = {}): Runtime & { out: string[] } {
  const out: string[] = [];
  return {
    env: ENV,
    configDir: dir,
    stdout: (text) => {
      out.push(text);
    },
    prompt: async () => {
      throw new Error("prompted");
    },
    backend,
    hostname: () => "Seshans-MacBook.local",
    now: () => 0,
    sleep: async () => {},
    out,
    ...extra,
  };
}

describe("machineName", () => {
  test("keeps a hostname and drops anything that is not one", () => {
    expect(machineName(" Seshans-MacBook.local ")).toBe("Seshans-MacBook.local");
    expect(machineName("bad host!")).toBeUndefined();
    expect(machineName("")).toBeUndefined();
    expect(machineName("a".repeat(254))).toBeUndefined();
  });
});

describe("waitForApproval", () => {
  const wait = (statuses: PairingStatus[], timeoutMs = 10_000) => {
    let index = 0;
    let clock = 0;
    return {
      poll: async () => statuses[Math.min(index++, statuses.length - 1)] ?? "pending",
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
      timeoutMs,
      intervalMs: 1_000,
    };
  };

  test("returns once the phone approves, after pending polls", async () => {
    await expect(waitForApproval(wait(["pending", "pending", "paired"]))).resolves.toBeUndefined();
  });

  test("throws a short message when the phone rejects", async () => {
    await expect(waitForApproval(wait(["pending", "rejected"]))).rejects.toThrow(/rejected on your phone/);
  });

  test("throws when the request expires or is not found", async () => {
    await expect(waitForApproval(wait(["expired"]))).rejects.toThrow(/expired/);
    await expect(waitForApproval(wait(["not_found"]))).rejects.toThrow(/expired/);
  });

  test("gives up at the timeout with a non-zero CliError", async () => {
    const error = await waitForApproval(wait(["pending"], 3_000)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(1);
    expect((error as CliError).message).toMatch(/no answer on your phone/);
  });
});

describe("puck add signed in", () => {
  test("sends the colour, hostname and token, waits, then writes the key on approval", async () => {
    const dir = await tempDir();
    try {
      const seen: { colour?: string; addedFrom?: string; token?: string | null } = {};
      const r = runtime(dir, fakeBackend(["pending", "paired"], seen), { convexToken: async () => "clerk-token" });
      const text = await addBot("cortana", r, { colour: "indigo" });
      expect(text).toBe("approved\n");
      expect(r.out.join("")).toContain("code: 042815\nbot: cortana-12345\n");
      expect(r.out.join("")).not.toContain(SECRET);
      expect(seen).toEqual({ colour: "indigo", addedFrom: "Seshans-MacBook.local", token: "clerk-token" });
      expect(await readBotKey(dir, "cortana-12345")).toBe(SECRET);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("on rejection the key is not written and the command fails", async () => {
    const dir = await tempDir();
    try {
      const r = runtime(dir, fakeBackend(["rejected"]), { convexToken: async () => "clerk-token" });
      await expect(addBot("cortana", r)).rejects.toThrow(/rejected on your phone/);
      await expect(readBotKey(dir, "cortana-12345")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the --color spelling is the same option, and two different values are refused", async () => {
    const dir = await tempDir();
    try {
      const seen: { colour?: string } = {};
      const r = runtime(dir, fakeBackend(["paired"], seen), { convexToken: async () => null });
      await addBot("cortana", r, { color: "teal" });
      expect(seen.colour).toBe("teal");
      await expect(addBot("cortana", r, { colour: "teal", color: "sky" })).rejects.toThrow(/one colour/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a colour outside the palette is refused before anything is sent", async () => {
    const dir = await tempDir();
    try {
      const r = runtime(dir, fakeBackend(["paired"]));
      await expect(addBot("cortana", r, { colour: "purple" })).rejects.toThrow(/colour must be one of/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("signed out, it prints the code and does not wait", async () => {
    const dir = await tempDir();
    try {
      const r = runtime(dir, fakeBackend(["pending"]), { convexToken: async () => null });
      const text = await addBot("cortana", r);
      expect(text).toBe("code: 042815\nbot: cortana-12345\n");
      expect(r.out).toEqual([]);
      expect(await readBotKey(dir, "cortana-12345")).toBe(SECRET);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
