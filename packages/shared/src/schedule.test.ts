import { describe, expect, test } from "bun:test";
import { cancelStep, releaseStep } from "./schedule";

const now = 1_700_000_000_000;

describe("releaseStep", () => {
  test("rings when the time has arrived and waits when it has not", () => {
    expect(releaseStep("scheduled", now - 1, now)).toBe("pending");
    expect(releaseStep("scheduled", now, now)).toBe("pending");
    expect(releaseStep("scheduled", null, now)).toBe("pending");
    expect(releaseStep("scheduled", now + 60_000, now)).toBe("wait");
  });

  test("ignores an alert that was cancelled or already sent", () => {
    expect(releaseStep("cancelled", now, now)).toBe("skip");
    expect(releaseStep("pending", now, now)).toBe("skip");
    expect(releaseStep("answered", now, now)).toBe("skip");
  });
});

describe("cancelStep", () => {
  test("cancels a waiting alert and refuses an answer", () => {
    expect(cancelStep("scheduled")).toBe("cancelled");
    expect(cancelStep("pending")).toBe("cancelled");
    expect(cancelStep("cancelled")).toBe("unchanged");
    expect(cancelStep("answered")).toBe("rejected");
  });
});
