import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAlertStatus, type AlertStatusView, type Backend } from "./backend";
import { WAIT_EXIT, waitForAnswer, type Runtime } from "./commands";
import { createProgram } from "./program";
import { parseDuration } from "./time";

const SECRET = "bot-secret-do-not-print";
const ID = "q_01HV7K3M2ZABCDEF";

function view(status: AlertStatusView["status"], answered = false): AlertStatusView {
  return {
    questionId: ID,
    question: "Ship it?",
    botId: "sheldon-23648",
    status,
    priority: "normal",
    selectionMode: "single",
    presentation: "choice",
    options: [{ id: "yes", label: "Yes" }],
    scheduledFor: null,
    snoozedUntil: null,
    createdAt: 1,
    answer: answered
      ? {
          answers: [{ id: "yes", label: "Yes" }],
          customReply: null,
          answeredAt: "2026-11-16T10:00:00.000Z",
          source: "app",
          deliveryStatus: "delivered",
          deliveryAttempts: 1,
          lastError: null,
          attachments: [],
        }
      : null,
  };
}

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function botDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "puck-wait-"));
  dirs.push(dir);
  await writeFile(join(dir, "config.json"), JSON.stringify({ deploymentUrl: "https://example.convex.cloud" }), "utf8");
  await writeFile(join(dir, "sheldon-23648.key"), `${SECRET}\n`, { mode: 0o600 });
  return dir;
}

/** A backend whose alert walks through `steps` (a view, or an Error to throw), then repeats the last. */
function backend(steps: (AlertStatusView | Error)[], seen: { reads: number; posted: number }): Backend {
  const unused = async () => {
    throw new Error("not used");
  };
  return {
    pairingStatus: unused,
    createPairing: unused,
    updateWebhook: unused,
    postStatus: unused,
    listAlerts: unused,
    cancelAlert: unused,
    async postAlert(_site, _bot, secret) {
      expect(secret).toBe(SECRET);
      seen.posted += 1;
      return { questionId: ID };
    },
    async getAlert(_site, _bot, secret, questionId) {
      expect(secret).toBe(SECRET);
      expect(questionId).toBe(ID);
      const step = steps[Math.min(seen.reads, steps.length - 1)]!;
      seen.reads += 1;
      if (step instanceof Error) throw step;
      return step;
    },
  } as Backend;
}

/** A runtime on a fake clock: each sleep moves time on by what it was asked. */
function runtime(dir: string, b: Backend, out: { stdout: string; stderr: string }): Runtime {
  let clock = 0;
  return {
    env: {},
    configDir: dir,
    stdout: (text) => (out.stdout += text),
    stderr: (text) => (out.stderr += text),
    prompt: async () => {
      throw new Error("prompted");
    },
    backend: b,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };
}

const MIN = 60_000;

describe("waitForAnswer", () => {
  test("returns the answer as JSON once the person answers", async () => {
    const seen = { reads: 0, posted: 0 };
    const out = { stdout: "", stderr: "" };
    const r = runtime(await botDir(), backend([view("pending"), view("pending"), view("answered", true)], seen), out);
    const result = await waitForAnswer(ID, "sheldon-23648", { timeoutMs: 30 * MIN, throughSnooze: false }, r);
    expect(result.exitCode).toBe(WAIT_EXIT.answered);
    expect(JSON.parse(result.text).answer.answers).toEqual([{ id: "yes", label: "Yes" }]);
    expect(seen.reads).toBe(3);
  });

  test("a snooze ends the wait, unless asked to wait through it", async () => {
    const steps = [view("pending"), view("snoozed"), view("snoozed"), view("answered", true)];
    const r1 = runtime(await botDir(), backend(steps, { reads: 0, posted: 0 }), { stdout: "", stderr: "" });
    expect((await waitForAnswer(ID, "sheldon-23648", { timeoutMs: 30 * MIN, throughSnooze: false }, r1)).exitCode).toBe(
      WAIT_EXIT.snoozed,
    );
    const r2 = runtime(await botDir(), backend(steps, { reads: 0, posted: 0 }), { stdout: "", stderr: "" });
    expect((await waitForAnswer(ID, "sheldon-23648", { timeoutMs: 30 * MIN, throughSnooze: true }, r2)).exitCode).toBe(
      WAIT_EXIT.answered,
    );
  });

  test("a cancelled alert ends the wait", async () => {
    const r = runtime(await botDir(), backend([view("cancelled")], { reads: 0, posted: 0 }), { stdout: "", stderr: "" });
    expect((await waitForAnswer(ID, "sheldon-23648", { timeoutMs: MIN, throughSnooze: false }, r)).exitCode).toBe(WAIT_EXIT.cancelled);
  });

  test("time up: the alert as it stands, and the timed-out exit code", async () => {
    const seen = { reads: 0, posted: 0 };
    const r = runtime(await botDir(), backend([view("pending")], seen), { stdout: "", stderr: "" });
    const result = await waitForAnswer(ID, "sheldon-23648", { timeoutMs: 10_000, throughSnooze: false }, r);
    expect(result.exitCode).toBe(WAIT_EXIT.timedOut);
    expect(JSON.parse(result.text).status).toBe("pending");
    // Checks at 0, 3, 6, 9 and the deadline (10 s).
    expect(seen.reads).toBe(5);
  });

  test("rides out a few failed checks, but gives up after five in a row", async () => {
    const blip = new Error("network");
    const ok = runtime(await botDir(), backend([blip, blip, view("answered", true)], { reads: 0, posted: 0 }), { stdout: "", stderr: "" });
    expect((await waitForAnswer(ID, "sheldon-23648", { timeoutMs: MIN, throughSnooze: false }, ok)).exitCode).toBe(WAIT_EXIT.answered);
    const down = runtime(await botDir(), backend([blip], { reads: 0, posted: 0 }), { stdout: "", stderr: "" });
    await expect(waitForAnswer(ID, "sheldon-23648", { timeoutMs: 30 * MIN, throughSnooze: false }, down)).rejects.toThrow("network");
  });
});

describe("puck send --wait", () => {
  const ALERT = JSON.stringify({ question: "Ship it?", priority: "normal", selectionMode: "single", options: [{ id: "yes", label: "Yes" }] });

  async function run(args: string[], steps: AlertStatusView[]) {
    const dir = await botDir();
    const file = join(dir, "alert.json");
    await writeFile(file, ALERT, "utf8");
    const seen = { reads: 0, posted: 0 };
    const out = { stdout: "", stderr: "" };
    const before = process.exitCode;
    try {
      await createProgram(runtime(dir, backend(steps, seen), out)).parseAsync(["node", "puck", "send", "--file", file, "--bot", "sheldon-23648", ...args]);
      return { out, seen, exitCode: process.exitCode ?? 0 };
    } finally {
      process.exitCode = before;
    }
  }

  test("prints the answer, with the id on stderr first", async () => {
    const { out, seen, exitCode } = await run(["--wait"], [view("answered", true)]);
    expect(seen.posted).toBe(1);
    expect(out.stderr).toBe(`${ID} sent, waiting for the answer\n`);
    expect(JSON.parse(out.stdout).questionId).toBe(ID);
    expect(exitCode).toBe(0);
  });

  test("a snooze sets exit code 3", async () => {
    expect((await run(["--wait", "--timeout", "5m"], [view("snoozed")])).exitCode).toBe(WAIT_EXIT.snoozed);
  });

  test("without --wait it prints only the id, as before", async () => {
    const { out, seen } = await run([], [view("answered", true)]);
    expect(out.stdout).toBe(`${ID}\n`);
    expect(seen.reads).toBe(0);
  });

  test("--timeout without --wait, or a bad timeout, is refused before anything is sent", async () => {
    await expect(run(["--timeout", "5m"], [])).rejects.toThrow(/need --wait/);
    await expect(run(["--wait", "--timeout", "soon"], [])).rejects.toThrow(/timeout must look like/);
  });
});

describe("parseDuration", () => {
  test("seconds, minutes and hours, within 1 second to 7 days", () => {
    expect(parseDuration("45")).toBe(45_000);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("30m")).toBe(30 * MIN);
    expect(parseDuration("2h")).toBe(120 * MIN);
    expect(() => parseDuration("0")).toThrow(/between/);
    expect(() => parseDuration("8d")).toThrow(/look like/);
    expect(() => parseDuration("200h")).toThrow(/between/);
  });
});

describe("parseAlertStatus", () => {
  const base = {
    questionId: ID,
    question: "Ship it?",
    botId: "sheldon-23648",
    status: "answered",
    priority: "normal",
    selectionMode: "single",
    presentation: "choice",
    options: [{ id: "yes", label: "Yes" }],
    scheduledFor: null,
    createdAt: 1,
  };
  const answer = {
    answers: [{ id: "yes", label: "Yes" }],
    customReply: null,
    answeredAt: "2026-11-16T10:00:00.000Z",
    source: "app",
    deliveryStatus: "delivered",
    deliveryAttempts: 1,
    lastError: null,
  };

  test("keeps the reply's files and the snooze end as ISO time", () => {
    const file = { type: "photo" as const, name: "a.png", mime: "image/png", size: 10, url: "https://files.example/a" };
    const parsed = parseAlertStatus({ ...base, snoozedUntil: Date.UTC(2026, 10, 16, 11), answer: { ...answer, attachments: [file, { type: "x" }] } });
    expect(parsed.answer?.attachments).toEqual([file]);
    expect(parsed.snoozedUntil).toBe("2026-11-16T11:00:00.000Z");
  });

  test("an older server without them reads as no files and no snooze end", () => {
    const parsed = parseAlertStatus({ ...base, answer });
    expect(parsed.answer?.attachments).toEqual([]);
    expect(parsed.snoozedUntil).toBeNull();
  });
});
