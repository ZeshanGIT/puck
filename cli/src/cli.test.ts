import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AlertBody, Backend } from "./backend";

import { askQuestion, sendQuestion, addBot, type Runtime } from "./commands";
import { loadConfig, siteUrlFromDeployment } from "./config";
import { PHASE_8 } from "./errors";
import { optionIdFromLabel, optionsFromLabels } from "./ids";
import { readBotKey } from "./keyfile";
import { createProgram } from "./program";
import { applyHiddenChar, promptHidden, readPipedLine } from "./prompt";

const SECRET = "bot-secret-do-not-print";
const HEADER = "Bearer header-do-not-print";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "puck-cli-"));
}

function runtime(configDir: string, backend: Backend, env: NodeJS.ProcessEnv = {}): Runtime {
  return {
    env,
    configDir,
    stdout: () => {},
    prompt: async () => {
      throw new Error("prompted");
    },
    backend,
  };
}

async function writeConfig(configDir: string): Promise<void> {
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ deploymentUrl: "https://example.convex.cloud" }),
    "utf8",
  );
}

describe("option ids", () => {
  test("the same label always gets the same id, and duplicates get a suffix", () => {
    expect(optionsFromLabels(["Ship it", "Snooze 10m", "ship it"])).toEqual([
      { id: "ship-it", label: "Ship it" },
      { id: "snooze-10m", label: "Snooze 10m" },
      { id: "ship-it-2", label: "ship it" },
    ]);
    const used = new Set<string>();
    expect(optionIdFromLabel("Yes", used)).toBe("yes");
    expect(optionIdFromLabel("Yes", used)).toBe("yes-2");
  });
});

describe("config", () => {
  test("env overrides the file, and a cloud URL implies the site URL", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      const config = await loadConfig(dir, { PUCK_DEPLOYMENT_URL: "https://other.convex.cloud/" });
      expect(config.deploymentUrl).toBe("https://other.convex.cloud");
      expect(config.siteUrl).toBe("https://other.convex.site");
      expect(siteUrlFromDeployment("https://usable-mule-44.convex.cloud")).toBe("https://usable-mule-44.convex.site");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("hidden prompt", () => {
  test("keystrokes are not echoed", () => {
    let state = "";
    let echoed = "";
    for (const ch of "secret\n") {
      const next = applyHiddenChar(state, ch);
      state = next.state;
      echoed += next.echo;
      if (next.done) break;
    }
    expect(state).toBe("secret");
    expect(echoed).toBe("\n");
    expect(echoed).not.toContain("secret");
  });

  test("a pipe is read without writing the line back", async () => {
    const input = new PassThrough();
    const output: string[] = [];
    const sink = new PassThrough();
    sink.on("data", (chunk: Buffer) => {
      output.push(chunk.toString());
    });
    const pending = promptHidden("Webhook URL: ", input, sink);
    input.end("https://example.com/hook\n");
    const value = await pending;
    expect(value).toBe("https://example.com/hook");
    expect(output.join("")).toBe("Webhook URL: ");
    const second = new PassThrough();
    second.end("one\ntwo\n");
    expect(await readPipedLine(second)).toBe("one");
    expect(await readPipedLine(second)).toBe("two");
  });
});

describe("puck add", () => {
  test("writes the key at mode 0600 and does not print the secret", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      let seenHeader = "";
      const backend: Backend = {
        async createPairing(_url, input) {
          seenHeader = input.webhookHeader;
          return { botId: "sheldon-23648", secret: SECRET, pairingCode: "042815" };
        },
        async postAlert() {
          throw new Error("not used");
        },
      };
      const text = await addBot("Sheldon", runtime(dir, backend, { PUCK_WEBHOOK_URL: "https://httpbin.org/post", PUCK_WEBHOOK_HEADER: HEADER }));
      expect(text).toBe("code: 042815\nbot: sheldon-23648\n");
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(HEADER);
      expect(seenHeader).toBe(HEADER);
      const mode = (await stat(join(dir, "sheldon-23648.key"))).mode & 0o777;
      expect(mode).toBe(0o600);
      expect(await readBotKey(dir, "sheldon-23648")).toBe(SECRET);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("puck ask and send", () => {
  test("ask posts stable ids and prints only the question id", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
      let body: AlertBody | undefined;
      let auth = "";
      const backend: Backend = {
        async createPairing() {
          throw new Error("not used");
        },
        async postAlert(_site, _bot, secret, posted) {
          auth = secret;
          body = posted;
          return { questionId: "q_01HV7K3M2ZABCDEF" };
        },
      };
      const text = await askQuestion(
        { question: "Up yet?", labels: ["Yes", "Snooze 10m"], multi: false, priority: "urgent", bot: "sheldon-23648" },
        runtime(dir, backend),
      );
      expect(text).toBe("q_01HV7K3M2ZABCDEF\n");
      expect(text).not.toContain(SECRET);
      expect(auth).toBe(SECRET);
      expect(body).toEqual({
        question: "Up yet?",
        priority: "urgent",
        selectionMode: "single",
        options: [
          { id: "yes", label: "Yes" },
          { id: "snooze-10m", label: "Snooze 10m" },
        ],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("send is an ask with one OK option", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
      let body: AlertBody | undefined;
      const backend: Backend = {
        async createPairing() {
          throw new Error("not used");
        },
        async postAlert(_site, _bot, _secret, posted) {
          body = posted;
          return { questionId: "q_01HV7K3M2ZABCDEF" };
        },
      };
      const text = await sendQuestion({ message: "Gym time", priority: "normal", bot: "sheldon-23648" }, runtime(dir, backend));
      expect(text).toBe("q_01HV7K3M2ZABCDEF\n");
      expect(body?.selectionMode).toBe("single");
      expect(body?.options).toEqual([{ id: "ok", label: "OK" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("argument parsing", () => {
  test("drops webhook and timeout, and rejects a schedule", async () => {
    const dir = await tempDir();
    try {
      const backend: Backend = {
        async createPairing() {
          throw new Error("network");
        },
        async postAlert() {
          throw new Error("network");
        },
      };
      const help = createProgram(runtime(dir, backend)).commands.find((command) => command.name() === "ask")?.helpInformation() ?? "";
      expect(help).not.toContain("--webhook");
      expect(help).not.toContain("--timeout");
      expect(help.toLowerCase()).not.toContain("wait for a reply");

      const parse = (argv: string[]) => createProgram(runtime(dir, backend)).parseAsync(argv, { from: "user" });
      await expect(parse(["ask", "Up yet?", "--options", "Yes,No", "--webhook", "https://example.com"])).rejects.toThrow(/unknown option/u);
      await expect(parse(["ask", "Up yet?", "--options", "Yes,No", "--timeout", "10"])).rejects.toThrow(/unknown option/u);
      await expect(parse(["ask", "Up yet?", "--options", "Yes,No", "--at", "06:00"])).rejects.toThrow(PHASE_8);
      await expect(parse(["schedule", "Wake up", "--at", "06:00"])).rejects.toThrow(PHASE_8);
      await expect(parse(["send", "Gym time", "--at", "06:00"])).rejects.toThrow(PHASE_8);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
