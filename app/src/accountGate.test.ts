import { describe, expect, test } from "bun:test";
import { appGate, nextStep, type AppGate } from "./accountGate";

type Input = Parameters<typeof appGate>[0];

const signedInReady: Input = {
  clerk: "in",
  registration: "ready",
  onboarding: "incomplete",
  step: null,
  freshSignIn: false,
};

function gate(overrides: Partial<Input>): AppGate {
  return appGate({ ...signedInReady, ...overrides });
}

describe("appGate", () => {
  test("O0 shows while the session or onboarding flag is still being read", () => {
    expect(gate({ clerk: "unknown" })).toBe("opening");
    expect(gate({ onboarding: "unknown" })).toBe("opening");
    expect(gate({ registration: "pending" })).toBe("opening");
  });

  test("signed out is O1, whatever else is stored", () => {
    expect(gate({ clerk: "out", registration: "pending" })).toBe("welcome");
    expect(gate({ clerk: "out", onboarding: "complete" })).toBe("welcome");
  });

  test("a registration problem (name clash, retry) is fixed on O1", () => {
    expect(gate({ registration: "attention" })).toBe("welcome");
    expect(gate({ registration: "attention", onboarding: "complete" })).toBe("welcome");
  });

  test("right after signing in on O1 the screen stays put while the phone registers", () => {
    expect(gate({ registration: "pending", freshSignIn: true })).toBe("welcome");
    expect(gate({ registration: "pending", freshSignIn: false })).toBe("opening");
  });

  test("a signed-in, registered phone that finished onboarding goes to the inbox", () => {
    expect(gate({ onboarding: "complete" })).toBe("inbox");
    expect(gate({ onboarding: "complete", step: "test" })).toBe("inbox");
  });

  test("otherwise it is the onboarding step in progress, O2 by default", () => {
    expect(gate({})).toBe("permissions");
    expect(gate({ step: "permissions" })).toBe("permissions");
    expect(gate({ step: "test" })).toBe("test");
    expect(gate({ step: "first-bot" })).toBe("first-bot");
    expect(gate({ step: "welcome" })).toBe("welcome");
  });
});

describe("nextStep", () => {
  test("goes welcome, permissions, test, first bot, then ends", () => {
    expect(nextStep("welcome")).toBe("permissions");
    expect(nextStep("permissions")).toBe("test");
    expect(nextStep("test")).toBe("first-bot");
    expect(nextStep("first-bot")).toBeNull();
  });
});
