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
        { action: "start", title: "Fix the build", steps: ["Read", "Test", "Ship"], link: "https://example.com/pr/1" },
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
        { action: "step", step: "Running the tests" },
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
        { action: "end", state: "done" },
        { action: "end", state: "failed" },
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

  test("the program parses the four subcommands into the same calls", async () => {
    await withBot(async (dir) => {
      const posted: LiveCommand[] = [];
      const program = createProgram(runtime(dir, fake(posted)));
      await program.parseAsync(["node", "puck", "status", "start", "--title", "Fix", "--steps", "A|B", "--bot", "sheldon-23648"]);
      await program.parseAsync(["node", "puck", "status", "step", "Running the tests", "--bot", "sheldon-23648"]);
      await program.parseAsync(["node", "puck", "status", "steps", "A|X|B", "--bot", "sheldon-23648"]);
      await program.parseAsync(["node", "puck", "status", "end", "--failed", "--bot", "sheldon-23648"]);
      expect(posted).toEqual([
        { action: "start", title: "Fix", steps: ["A", "B"], link: null },
        { action: "step", step: "Running the tests" },
        { action: "steps", steps: ["A", "X", "B"] },
        { action: "end", state: "failed" },
      ]);
    });
  });
});
