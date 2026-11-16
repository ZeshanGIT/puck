import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Backend } from "./backend";
import type { LiveCommand } from "@puck/shared";
import { statusCommand, parseSteps, type Runtime } from "./commands";
import { CliError } from "./errors";
import { createProgram } from "./program";

const SECRET = "bot-secret-do-not-print";

async function withBot<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "puck-status-"));
  try {
    await writeFile(join(dir, "config.json"), JSON.stringify({ deploymentUrl: "https://example.convex.cloud" }), "utf8");
    await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fake(posted: LiveCommand[]): Backend {
  return {
    async pairingStatus() {
      return "paired" as const;
    },
    async createPairing() {
      throw new Error("not used");
    },
    async updateWebhook() {
      throw new Error("not used");
    },
    async postStatus(_site, _bot, secret, body) {
      expect(secret).toBe(SECRET);
      posted.push(body);
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
    async getAlert() {
      throw new Error("not used");
    },
  };
}

function runtime(dir: string, backend: Backend): Runtime {
  return {
    env: {},
    configDir: dir,
    stdout: () => {},
    prompt: async () => {
      throw new Error("prompted");
    },
    backend,
  };
}

describe("parseSteps", () => {
  test("splits on | and trims each piece, keeping empty ones for the validator", () => {
    expect(parseSteps("A | B|C")).toEqual(["A", "B", "C"]);
    expect(parseSteps("A||C")).toEqual(["A", "", "C"]);
  });
});

describe("puck status", () => {
  test("start sends the title, steps and link, and reports started", async () => {
    await withBot(async (dir) => {
      const posted: LiveCommand[] = [];
      const text = await statusCommand(
        { action: "start", bot: "sheldon-23648", title: "Fix the build", steps: "Read|Test|Ship", link: "https://example.com/pr/1" },
        runtime(dir, fake(posted)),
      );
      expect(text).toBe("started\n");
      expect(posted).toEqual([
        { action: "start", title: "Fix the build", steps: ["Read", "Test", "Ship"], link: "https://example.com/pr/1", note: null },
      ]);
    });
  });

  test("step and steps send the text and the new list", async () => {
    await withBot(async (dir) => {
      const posted: LiveCommand[] = [];
      expect(await statusCommand({ action: "step", bot: "sheldon-23648", text: "Running the tests" }, runtime(dir, fake(posted)))).toBe(
        "step: Running the tests\n",
      );
      expect(await statusCommand({ action: "steps", bot: "sheldon-23648", steps: "A|B|X|C" }, runtime(dir, fake(posted)))).toBe(
        "steps: 4\n",
      );
      expect(posted).toEqual([
        { action: "step", step: "Running the tests", note: null },
        { action: "steps", steps: ["A", "B", "X", "C"] },
      ]);
    });
  });

  test("end defaults to done, --failed sends failed, and both flags are refused", async () => {
    await withBot(async (dir) => {
      const posted: LiveCommand[] = [];
      expect(await statusCommand({ action: "end", bot: "sheldon-23648" }, runtime(dir, fake(posted)))).toBe("ended: done\n");
      expect(await statusCommand({ action: "end", bot: "sheldon-23648", failed: true }, runtime(dir, fake(posted)))).toBe(
        "ended: failed\n",
      );
      expect(posted).toEqual([
        { action: "end", state: "done", note: null },
        { action: "end", state: "failed", note: null },
      ]);
      await expect(
        statusCommand({ action: "end", bot: "sheldon-23648", ok: true, failed: true }, runtime(dir, fake([]))),
      ).rejects.toThrow(/--ok or --failed, not both/);
    });
  });

  test("a bad body is a short CliError and nothing is posted", async () => {
    await withBot(async (dir) => {
      const posted: LiveCommand[] = [];
      const empty = await statusCommand({ action: "start", bot: "sheldon-23648", title: " " }, runtime(dir, fake(posted)))
        .catch((error: unknown) => error);
      expect(empty).toBeInstanceOf(CliError);
      expect((empty as CliError).message).toMatch(/title is required/);
      const badLink = await statusCommand(
        { action: "start", bot: "sheldon-23648", title: "x", link: "ftp://example.com" },
        runtime(dir, fake(posted)),
      ).catch((error: unknown) => error);
      expect((badLink as CliError).message).toMatch(/https:\/\/ or http:\/\//);
      const step = await statusCommand({ action: "steps", bot: "sheldon-23648", steps: "A||B" }, runtime(dir, fake(posted))).catch(
        (error: unknown) => error,
      );
      expect((step as CliError).message).toMatch(/steps\[1\] is required/);
      expect(posted).toEqual([]);
    });
  });

  test("the program parses the five subcommands into the same calls", async () => {
    await withBot(async (dir) => {
      const posted: LiveCommand[] = [];
      const program = createProgram(runtime(dir, fake(posted)));
      await program.parseAsync(["node", "puck", "status", "start", "--title", "Fix", "--steps", "A|B", "--bot", "sheldon-23648"]);
      await program.parseAsync(["node", "puck", "status", "step", "Running the tests", "--bot", "sheldon-23648"]);
      await program.parseAsync(["node", "puck", "status", "steps", "A|X|B", "--bot", "sheldon-23648"]);
      await program.parseAsync(["node", "puck", "status", "note", "120 of 312", "--bot", "sheldon-23648"]);
      await program.parseAsync(["node", "puck", "status", "end", "--failed", "--note", "2 failed", "--bot", "sheldon-23648"]);
      expect(posted).toEqual([
        { action: "start", title: "Fix", steps: ["A", "B"], link: null, note: null },
        { action: "step", step: "Running the tests", note: null },
        { action: "steps", steps: ["A", "X", "B"] },
        { action: "note", note: "120 of 312" },
        { action: "end", state: "failed", note: "2 failed" },
      ]);
    });
  });
});

describe("notes", () => {
  test("note on its own, and --note with start, step and end", async () => {
    await withBot(async (dir) => {
      const posted: LiveCommand[] = [];
      const r = runtime(dir, fake(posted));
      expect(await statusCommand({ action: "start", bot: "sheldon-23648", title: "Sync", note: "0 of 10" }, r)).toBe("started\n");
      expect(await statusCommand({ action: "note", bot: "sheldon-23648", note: "4 of 10" }, r)).toBe("note: 4 of 10\n");
      await statusCommand({ action: "step", bot: "sheldon-23648", text: "Verify", note: "checking hashes" }, r);
      await statusCommand({ action: "end", bot: "sheldon-23648", failed: true, note: "hash mismatch" }, r);
      expect(posted).toEqual([
        { action: "start", title: "Sync", steps: null, link: null, note: "0 of 10" },
        { action: "note", note: "4 of 10" },
        { action: "step", step: "Verify", note: "checking hashes" },
        { action: "end", state: "failed", note: "hash mismatch" },
      ]);
      await expect(statusCommand({ action: "note", bot: "sheldon-23648", note: " " }, r)).rejects.toThrow(/note is required/);
    });
  });
});
