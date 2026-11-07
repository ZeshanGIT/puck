import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AlertBody, Backend } from "./backend";

import { addBot, cancelAlert, listAlerts, scheduleAlert, sendAlert, type Runtime } from "./commands";
import { loadConfig, siteUrlFromDeployment } from "./config";
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
        async pairingStatus() {
          return "paired" as const;
        },
        async createPairing(_url, input) {
          seenHeader = input.webhookHeader;
          return { botId: "sheldon-23648", secret: SECRET, pairingCode: "042815" };
        },
        async updateWebhook() {
          throw new Error("not used");
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

const ALERT = {
  question: "Up yet?",
  priority: "urgent" as const,
  selectionMode: "single" as const,
  options: [
    { id: "yes", label: "Yes" },
    { id: "snooze-10m", label: "Snooze 10m" },
  ],
};

describe("puck send", () => {
  test("a file posts the JSON and prints only the question id", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
      const file = join(dir, "alert.json");
      await writeFile(file, JSON.stringify(ALERT));
      let body: AlertBody | undefined;
      let auth = "";
      const backend: Backend = {
        async pairingStatus() {
          return "paired" as const;
        },
        async createPairing() {
          throw new Error("not used");
        },
        async updateWebhook() {
          throw new Error("not used");
        },
        async postStatus() {
          throw new Error("not used");
        },
        async postAlert(_site, _bot, secret, posted) {
          auth = secret;
          body = posted;
          return { questionId: "q_01HV7K3M2ZABCDEF" };
        },
        async listAlerts() {
          throw new Error("not used");
        },
        async cancelAlert() {
          throw new Error("not used");
        },
      };
      const text = await sendAlert({ file, bot: "sheldon-23648" }, runtime(dir, backend));
      expect(text).toBe("q_01HV7K3M2ZABCDEF\n");
      expect(text).not.toContain(SECRET);
      expect(auth).toBe(SECRET);
      expect(body).toEqual({ ...ALERT, presentation: "choice" });
      expect(await readFile(file, "utf8")).toBe(JSON.stringify(ALERT));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stdin posts the same JSON", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
      let body: AlertBody | undefined;
      const backend: Backend = {
        async pairingStatus() {
          return "paired" as const;
        },
        async createPairing() {
          throw new Error("not used");
        },
        async updateWebhook() {
          throw new Error("not used");
        },
        async postStatus() {
          throw new Error("not used");
        },
        async postAlert(_site, _bot, _secret, posted) {
          body = posted;
          return { questionId: "q_01HV7K3M2ZABCDEF" };
        },
        async listAlerts() {
          throw new Error("not used");
        },
        async cancelAlert() {
          throw new Error("not used");
        },
      };
      const stdin = new PassThrough();
      const pending = sendAlert({ bot: "sheldon-23648", stdin }, runtime(dir, backend));
      stdin.end(JSON.stringify(ALERT));
      expect(await pending).toBe("q_01HV7K3M2ZABCDEF\n");
      expect(body).toEqual({ ...ALERT, presentation: "choice" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a scheduled alert posts its time", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
      const file = join(dir, "alert.json");
      await writeFile(file, JSON.stringify({ ...ALERT, scheduledFor: 1_700_000_000_000 }));
      let body: AlertBody | undefined;
      const backend: Backend = {
        async pairingStatus() {
          return "paired" as const;
        },
        async createPairing() {
          throw new Error("not used");
        },
        async updateWebhook() {
          throw new Error("not used");
        },
        async postStatus() {
          throw new Error("not used");
        },
        async postAlert(_site, _bot, _secret, posted) {
          body = posted;
          return { questionId: "q_01HV7K3M2ZABCDEF" };
        },
        async listAlerts() {
          throw new Error("not used");
        },
        async cancelAlert() {
          throw new Error("not used");
        },
      };
      expect(await sendAlert({ file, bot: "sheldon-23648" }, runtime(dir, backend))).toBe("q_01HV7K3M2ZABCDEF\n");
      expect(body?.scheduledFor).toBe(1_700_000_000_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("puck schedule", () => {
  test("posts an OK alert for the next clock time and can list and cancel it", async () => {
    const dir = await tempDir();
    try {
      await writeConfig(dir);
      await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
      let body: AlertBody | undefined;
      const listed = [
        {
          questionId: "q_01HV7K3M2ZABCDEF",
          question: "Wake up",
          status: "scheduled" as const,
          priority: "normal" as const,
          scheduledFor: new Date(2026, 9, 30, 6, 0, 0, 0).getTime(),
          createdAt: 1,
        },
      ];
      let cancelled = "";
      const backend: Backend = {
        async pairingStatus() {
          return "paired" as const;
        },
        async createPairing() {
          throw new Error("not used");
        },
        async updateWebhook() {
          throw new Error("not used");
        },
        async postStatus() {
          throw new Error("not used");
        },
        async postAlert(_site, _bot, _secret, posted) {
          body = posted;
          return { questionId: "q_01HV7K3M2ZABCDEF" };
        },
        async listAlerts() {
          return listed;
        },
        async cancelAlert(_site, _bot, _secret, questionId) {
          cancelled = questionId;
        },
      };
      const runtimeFor = runtime(dir, backend);
      expect(await scheduleAlert({ message: "Wake up", at: "06:00", bot: "sheldon-23648" }, runtimeFor)).toBe(
        "q_01HV7K3M2ZABCDEF\n",
      );
      expect(body?.question).toBe("Wake up");
      expect(body?.options).toEqual([{ id: "ok", label: "OK" }]);
      expect(typeof body?.scheduledFor).toBe("number");
      expect(await listAlerts("sheldon-23648", runtimeFor)).toContain("q_01HV7K3M2ZABCDEF  scheduled");
      expect(await listAlerts("sheldon-23648", runtimeFor)).toContain("Wake up");
      expect(await cancelAlert("q_01HV7K3M2ZABCDEF", "sheldon-23648", runtimeFor)).toBe(
        "cancelled q_01HV7K3M2ZABCDEF\n",
      );
      expect(cancelled).toBe("q_01HV7K3M2ZABCDEF");
      await expect(cancelAlert("nope", "sheldon-23648", runtimeFor)).rejects.toThrow(/not valid/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("argument parsing", () => {
  test("drops webhook and timeout", async () => {
    const dir = await tempDir();
    try {
      const backend: Backend = {
        async pairingStatus() {
          return "paired" as const;
        },
        async createPairing() {
          throw new Error("network");
        },
        async updateWebhook() {
          throw new Error("network");
        },
        async postStatus() {
          throw new Error("not used");
        },
        async postAlert() {
          throw new Error("network");
        },
        async listAlerts() {
          throw new Error("network");
        },
        async cancelAlert() {
          throw new Error("network");
        },
      };
      const help = createProgram(runtime(dir, backend)).commands.find((command) => command.name() === "send")?.helpInformation() ?? "";
      expect(help).not.toContain("--webhook");
      expect(help).not.toContain("--timeout");
      expect(help.toLowerCase()).not.toContain("wait for a reply");

      const parse = (argv: string[]) => createProgram(runtime(dir, backend)).parseAsync(argv, { from: "user" });
      await expect(parse(["ask", "Up yet?"])).rejects.toThrow(/unknown command/u);
      await expect(parse(["send", "--webhook", "https://example.com"])).rejects.toThrow(/unknown option/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
