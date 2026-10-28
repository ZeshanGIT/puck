import { describe, expect, test } from "bun:test";
import { AlertValidationError, validateAnswer, validateCreateAlert, validatePairingInput } from "./validate";

const ship = {
  question: "Ship the 0.3 build tonight?",
  priority: "urgent",
  selectionMode: "single",
  options: [
    { id: "ship", label: "Ship it" },
    { id: "hold", label: "Hold", icon: "pause" },
  ],
};

describe("validateCreateAlert", () => {
  test("accepts a single-select alert with an optional icon", () => {
    expect(validateCreateAlert(ship)).toEqual({
      question: ship.question,
      priority: "urgent",
      selectionMode: "single",
      options: [
        { id: "ship", label: "Ship it" },
        { id: "hold", label: "Hold", icon: "pause" },
      ],
      scheduledFor: null,
    });
  });

  test("rejects a bad priority, a duplicate id, and too many options", () => {
    expect(() => validateCreateAlert({ ...ship, priority: "high" })).toThrow(AlertValidationError);
    expect(() =>
      validateCreateAlert({
        ...ship,
        options: [
          { id: "ship", label: "Ship it" },
          { id: "ship", label: "Again" },
        ],
      }),
    ).toThrow(/duplicate option id/);
    expect(() =>
      validateCreateAlert({
        ...ship,
        options: [1, 2, 3, 4, 5].map((n) => ({ id: `o${n}`, label: `Option ${n}` })),
      }),
    ).toThrow(/at most 4 options/);
  });

  test("allows a one-way alert with no options", () => {
    const created = validateCreateAlert({
      question: "Gym time",
      priority: "normal",
      selectionMode: "single",
      options: [],
    });
    expect(created.options).toEqual([]);
  });
});

describe("validateAnswer", () => {
  const options = ship.options;

  test("keeps the stored label and a custom reply", () => {
    expect(
      validateAnswer({
        selectionMode: "single",
        options,
        optionIds: ["ship"],
        customReply: "Ship it, but skip the changelog email",
      }),
    ).toEqual({
      answers: [{ id: "ship", label: "Ship it" }],
      customReply: "Ship it, but skip the changelog email",
    });
  });

  test("rejects two options in single mode and an unknown id", () => {
    expect(() =>
      validateAnswer({ selectionMode: "single", options, optionIds: ["ship", "hold"] }),
    ).toThrow(/at most one option/);
    expect(() => validateAnswer({ selectionMode: "multi", options, optionIds: ["nope"] })).toThrow(
      /unknown option id/,
    );
  });

  test("accepts several options in multi mode and a custom reply on its own", () => {
    expect(
      validateAnswer({ selectionMode: "multi", options, optionIds: ["hold", "ship"] }).answers.map(
        (answer) => answer.id,
      ),
    ).toEqual(["hold", "ship"]);
    expect(
      validateAnswer({ selectionMode: "single", options, optionIds: [], customReply: "Not tonight" }),
    ).toEqual({ answers: [], customReply: "Not tonight" });
  });
});

describe("validatePairingInput", () => {
  test("accepts an https webhook and a one-line authorization header", () => {
    expect(
      validatePairingInput({
        name: "Sheldon",
        webhookUrl: "https://example.com/hooks/puck",
        webhookHeader: "Bearer routine-key",
        routine: "Puck answer-back",
      }),
    ).toEqual({
      name: "sheldon",
      webhookUrl: "https://example.com/hooks/puck",
      webhookHeader: "Bearer routine-key",
      routine: "Puck answer-back",
    });
  });

  test("rejects http URLs, credentials, and a header with a newline", () => {
    expect(() =>
      validatePairingInput({
        name: "sheldon",
        webhookUrl: "http://example.com/hook",
        webhookHeader: "Bearer x",
      }),
    ).toThrow(/https/);
    expect(() =>
      validatePairingInput({
        name: "sheldon",
        webhookUrl: "https://user:pass@example.com/hook",
        webhookHeader: "Bearer x",
      }),
    ).toThrow(/credentials/);
    expect(() =>
      validatePairingInput({
        name: "sheldon",
        webhookUrl: "https://example.com/hook",
        webhookHeader: "Bearer x\nEvil: 1",
      }),
    ).toThrow(/one line/);
  });
});
