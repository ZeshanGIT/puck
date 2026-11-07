import { describe, expect, test } from "bun:test";
import { signOutPhone, type SignOutSteps } from "./signOutFlow";

function steps(log: string[], over: Partial<SignOutSteps> = {}): SignOutSteps {
  return {
    removeClient: async () => void log.push("remove"),
    clearLocal: async () => void log.push("clear"),
    endSession: async () => void log.push("end"),
    ...over,
  };
}

describe("signOutPhone", () => {
  test("removes the row, then clears local state, then ends the session", async () => {
    const log: string[] = [];
    expect(await signOutPhone(steps(log))).toBe("removed");
    expect(log).toEqual(["remove", "clear", "end"]);
  });

  test("the session only ends after the removal has finished", async () => {
    const log: string[] = [];
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      log.push("remove");
    };
    await signOutPhone(steps(log, { removeClient: slow }));
    expect(log).toEqual(["remove", "clear", "end"]);
  });

  test("a failed removal does not block sign-out", async () => {
    const log: string[] = [];
    const outcome = await signOutPhone(
      steps(log, {
        removeClient: async () => {
          throw new Error("client not found");
        },
      }),
    );
    expect(outcome).toBe("failed");
    expect(log).toEqual(["clear", "end"]);
  });

  test("a removal that never answers times out and sign-out goes on", async () => {
    const log: string[] = [];
    const started = Date.now();
    const outcome = await signOutPhone(steps(log, { removeClient: () => new Promise<void>(() => {}) }), { timeoutMs: 30 });
    expect(outcome).toBe("timed-out");
    expect(log).toEqual(["clear", "end"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("the session still ends if clearing local state fails, then the error surfaces", async () => {
    const log: string[] = [];
    const run = signOutPhone(
      steps(log, {
        clearLocal: async () => {
          throw new Error("storage");
        },
      }),
    );
    await expect(run).rejects.toThrow("storage");
    expect(log).toEqual(["remove", "end"]);
  });
});
