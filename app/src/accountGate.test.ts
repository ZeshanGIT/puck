import { describe, expect, test } from "bun:test";
import { accountGate, appGate } from "./accountGate";

describe("accountGate", () => {
  test("sign-in comes before the setup code, and a claimed phone goes to the inbox", () => {
    expect(accountGate("unknown", "in")).toBe("opening");
    expect(accountGate("out", "in")).toBe("sign-in");
    expect(accountGate("in", "unknown")).toBe("opening");
    expect(accountGate("in", "out")).toBe("claim");
    expect(accountGate("in", "in")).toBe("inbox");
  });
});

describe("appGate", () => {
  test("onboarding wraps sign-in, claim, and the permission walkthrough", () => {
    expect(appGate("unknown", "in", "complete")).toBe("opening");
    expect(appGate("out", "in", "complete")).toBe("onboarding");
    expect(appGate("in", "out", "complete")).toBe("onboarding");
    expect(appGate("in", "in", "incomplete")).toBe("onboarding");
    expect(appGate("in", "in", "complete")).toBe("inbox");
  });
});
