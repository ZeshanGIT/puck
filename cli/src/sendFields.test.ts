import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AlertBody, Backend } from "./backend";
import { sendAlert, type Runtime } from "./commands";
import { CliError } from "./errors";

const SECRET = "bot-secret-do-not-print";
const FUTURE = Date.now() + 60 * 60 * 1000;

async function setup(alert: unknown): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "puck-send-"));
  await writeFile(join(dir, "config.json"), JSON.stringify({ deploymentUrl: "https://example.convex.cloud" }), "utf8");
  await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
  const file = join(dir, "alert.json");
  await writeFile(file, JSON.stringify(alert), "utf8");
  return { dir, file };
}

/** Runs `puck send --file` against a fake backend and returns the body it would POST. */
async function postedBody(alert: unknown): Promise<AlertBody> {
  const { dir, file } = await setup(alert);
  try {
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
      async getAlert() {
        throw new Error("not used");
      },
    };
    const runtime: Runtime = {
      env: {},
      configDir: dir,
      stdout: () => {},
      prompt: async () => {
        throw new Error("prompted");
      },
      backend,
    };
    await sendAlert({ file, bot: "sheldon-23648" }, runtime);
    if (!body) throw new Error("nothing was posted");
    return body;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function rejection(alert: unknown): Promise<CliError> {
  try {
    await postedBody(alert);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected the send to be refused");
}

describe("puck send forwards every alert field", () => {
  test("message, timing, ring and flags, and an option with desc, tone and rec all reach the body", async () => {
    const body = await postedBody({
      question: "Ship the 0.3 build tonight?",
      priority: "urgent",
      selectionMode: "single",
      presentation: "choice",
      options: [
        { id: "ship", label: "Ship it", desc: "Tags v0.3 and uploads", tone: "destructive", rec: true },
        { id: "hold", label: "Hold", icon: "pause" },
      ],
      message: "**Deploy** window opens at 18:00",
      details: "Full notes, _formatted_.",
      link: { label: "Open in Sheldon", url: "https://example.com/runs/42" },
      expiresAt: FUTURE,
      ringSeconds: 300,
      speak: true,
      bypassDnd: true,
      bypassSilent: false,
      requiresUnlock: true,
    });
    expect(body).toEqual({
      question: "Ship the 0.3 build tonight?",
      priority: "urgent",
      selectionMode: "single",
      presentation: "choice",
      options: [
        { id: "ship", label: "Ship it", desc: "Tags v0.3 and uploads", tone: "destructive", rec: true },
        { id: "hold", label: "Hold", icon: "pause" },
      ],
      message: "**Deploy** window opens at 18:00",
      details: "Full notes, _formatted_.",
      link: { label: "Open in Sheldon", url: "https://example.com/runs/42" },
      expiresAt: FUTURE,
      ringSeconds: 300,
      speak: true,
      bypassDnd: true,
      bypassSilent: false,
      requiresUnlock: true,
    });
    expect(body.scheduledFor).toBeUndefined();
  });

  test("a scheduled alert keeps its scheduledFor and an unscheduled one has none on the wire", async () => {
    const scheduled = await postedBody({
      question: "Stand up",
      priority: "normal",
      selectionMode: "single",
      options: [],
      scheduledFor: FUTURE,
    });
    expect(scheduled.scheduledFor).toBe(FUTURE);
    const plain = await postedBody({ question: "Stand up", priority: "normal", selectionMode: "single", options: [] });
    expect(JSON.parse(JSON.stringify(plain))).not.toHaveProperty("scheduledFor");
  });

  test("an invalid extra is refused with a short CliError and nothing is posted", async () => {
    const ringTooShort = await rejection({
      question: "Ring?",
      priority: "urgent",
      selectionMode: "single",
      options: [],
      ringSeconds: 2,
    });
    expect(ringTooShort.message).toMatch(/ringSeconds must be a whole number from 5 to 600/);
    expect(ringTooShort.exitCode).toBe(1);

    const badTone = await rejection({
      question: "Drop it?",
      priority: "normal",
      selectionMode: "single",
      options: [{ id: "drop", label: "Drop", tone: "warning" }],
    });
    expect(badTone.message).toMatch(/tone must be destructive/);

    const flagAsString = await rejection({
      question: "Speak?",
      priority: "normal",
      selectionMode: "single",
      options: [],
      speak: "yes",
    });
    expect(flagAsString.message).toMatch(/speak must be true or false/);
  });

  test("an expiry in the past is refused in the CLI, before any request", async () => {
    const past = await rejection({
      question: "Too late?",
      priority: "normal",
      selectionMode: "single",
      options: [],
      expiresAt: Date.now() - 1000,
    });
    expect(past.message).toMatch(/expiresAt must be in the future/);
  });
});
