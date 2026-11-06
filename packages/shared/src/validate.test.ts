import { describe, expect, test } from "bun:test";
import {
  AlertValidationError,
  validateAlertTiming,
  validateAnswer,
  validateCreateAlert,
  validatePairingInput,
} from "./validate";

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
      presentation: "choice",
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

  test("defaults a missing presentation to choice and rejects a three-option swipe", () => {
    expect(validateCreateAlert({ ...ship, presentation: undefined }).presentation).toBe("choice");
    expect(
      validateCreateAlert({
        ...ship,
        presentation: "swipe",
        selectionMode: "single",
      }).presentation,
    ).toBe("swipe");
    expect(() =>
      validateCreateAlert({
        ...ship,
        presentation: "swipe",
        options: [
          { id: "snooze", label: "Snooze" },
          { id: "dismiss", label: "Dismiss" },
          { id: "later", label: "Later" },
        ],
      }),
    ).toThrow(/one or two options/);
    expect(() => validateCreateAlert({ ...ship, presentation: "swipe", selectionMode: "multi" })).toThrow(
      /single choice/,
    );
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

  test("accepts a one-option choice (an FYI) and a one-option swipe", () => {
    const fyi = { id: "seen", label: "Got it" };
    expect(
      validateCreateAlert({ ...ship, options: [fyi] }).options,
    ).toEqual([fyi]);
    expect(
      validateCreateAlert({ ...ship, presentation: "swipe", options: [fyi] }),
    ).toMatchObject({ presentation: "swipe", options: [fyi] });
  });

  test("rejects a swipe with no options", () => {
    expect(() => validateCreateAlert({ ...ship, presentation: "swipe", options: [] })).toThrow(
      /one or two options/,
    );
  });

  test("keeps a v0 payload exactly as before", () => {
    const v0 = {
      question: "Ship the 0.3 build tonight?",
      priority: "normal",
      selectionMode: "single",
      presentation: "choice",
      options: [
        { id: "ship", label: "Ship it" },
        { id: "hold", label: "Hold", icon: "pause" },
      ],
      scheduledFor: 1_900_000_000_000,
    };
    const created = validateCreateAlert(v0);
    expect(created).toEqual(v0);
    expect(Object.keys(created).sort()).toEqual(
      ["options", "presentation", "priority", "question", "scheduledFor", "selectionMode"],
    );
  });
});

describe("validateCreateAlert new alert fields", () => {
  const future = 2_000_000_000_000;
  const extras = {
    message: "  **Deploy** window\nopens at 18:00  ",
    details: "Full notes, _formatted_.",
    link: { label: "Open in Sheldon", url: "https://example.com/runs/42" },
    expiresAt: future,
    ringSeconds: 300,
    speak: true,
    bypassDnd: false,
    bypassSilent: true,
    requiresUnlock: true,
  };

  test("accepts every field and trims the message but keeps its newline", () => {
    expect(validateCreateAlert({ ...ship, ...extras })).toEqual({
      question: ship.question,
      priority: "urgent",
      selectionMode: "single",
      presentation: "choice",
      options: ship.options,
      scheduledFor: null,
      message: "**Deploy** window\nopens at 18:00",
      details: "Full notes, _formatted_.",
      link: { label: "Open in Sheldon", url: "https://example.com/runs/42" },
      expiresAt: future,
      ringSeconds: 300,
      speak: true,
      bypassDnd: false,
      bypassSilent: true,
      requiresUnlock: true,
    });
  });

  test("leaves absent fields off the result and drops an empty details", () => {
    const created = validateCreateAlert({ ...ship, details: "   ", message: null, speak: null });
    for (const key of ["message", "details", "link", "expiresAt", "ringSeconds", "speak"]) {
      expect(key in created).toBe(false);
    }
  });

  test("checks the message length and control characters", () => {
    expect(() => validateCreateAlert({ ...ship, message: "   " })).toThrow(/message is required/);
    expect(() => validateCreateAlert({ ...ship, message: "x".repeat(1_001) })).toThrow(/message is too long/);
    expect(validateCreateAlert({ ...ship, message: "x".repeat(1_000) }).message).toHaveLength(1_000);
    expect(() => validateCreateAlert({ ...ship, message: "bad\u0007bell" })).toThrow(/control character/);
    expect(() => validateCreateAlert({ ...ship, message: 42 })).toThrow(/message must be a string/);
  });

  test("checks the details length", () => {
    expect(() => validateCreateAlert({ ...ship, details: "x".repeat(4_001) })).toThrow(/details is too long/);
    expect(validateCreateAlert({ ...ship, details: "x".repeat(4_000) }).details).toHaveLength(4_000);
  });

  test("checks the link label and url", () => {
    const link = (overrides: object) => validateCreateAlert({ ...ship, link: { ...extras.link, ...overrides } });
    expect(link({})).toMatchObject({ link: extras.link });
    expect(link({ url: "http://example.com/plain" }).link?.url).toBe("http://example.com/plain");
    expect(() => link({ url: "ftp://example.com/file" })).toThrow(/https:\/\/ or http:\/\//);
    expect(() => link({ url: "example.com/no-scheme" })).toThrow(/https:\/\/ or http:\/\//);
    expect(() => link({ url: "https://example.com/has space" })).toThrow(/whitespace/);
    expect(() => link({ url: `https://example.com/${"a".repeat(2_048)}` })).toThrow(/too long/);
    expect(() => link({ label: "" })).toThrow(/link.label is required/);
    expect(() => link({ label: "x".repeat(41) })).toThrow(/too long/);
    expect(() => validateCreateAlert({ ...ship, link: "https://example.com" })).toThrow(/link must be an object/);
  });

  test("checks expiresAt and ringSeconds shapes", () => {
    for (const expiresAt of [0, -1, 1.5, "soon"]) {
      expect(() => validateCreateAlert({ ...ship, expiresAt })).toThrow(/expiresAt must be epoch milliseconds/);
    }
    for (const ringSeconds of [4, 601, 60.5, "60"]) {
      expect(() => validateCreateAlert({ ...ship, ringSeconds })).toThrow(/ringSeconds must be a whole number/);
    }
    expect(validateCreateAlert({ ...ship, ringSeconds: 5 }).ringSeconds).toBe(5);
    expect(validateCreateAlert({ ...ship, ringSeconds: 600 }).ringSeconds).toBe(600);
  });

  test("rejects booleans given as strings or numbers", () => {
    for (const field of ["speak", "bypassDnd", "bypassSilent", "requiresUnlock"]) {
      expect(() => validateCreateAlert({ ...ship, [field]: "true" })).toThrow(/must be true or false/);
      expect(() => validateCreateAlert({ ...ship, [field]: 1 })).toThrow(/must be true or false/);
    }
  });

  test("checks option desc, tone and rec", () => {
    const withOption = (option: object) => ({
      ...ship,
      options: [{ id: "ship", label: "Ship it", ...option }, { id: "hold", label: "Hold" }],
    });
    expect(validateCreateAlert(withOption({ desc: "Tags v0.3 and uploads" })).options[0]).toEqual({
      id: "ship",
      label: "Ship it",
      desc: "Tags v0.3 and uploads",
    });
    expect(() => validateCreateAlert(withOption({ desc: "x".repeat(201) }))).toThrow(/desc is too long/);
    expect(() => validateCreateAlert(withOption({ desc: "  " }))).toThrow(/desc is required/);

    expect(validateCreateAlert(withOption({ tone: "destructive" })).options[0]?.tone).toBe("destructive");
    expect(() => validateCreateAlert(withOption({ tone: "warning" }))).toThrow(/tone must be destructive/);

    expect(validateCreateAlert(withOption({ rec: true })).options[0]?.rec).toBe(true);
    expect(validateCreateAlert(withOption({ rec: false })).options[0]?.rec).toBe(false);
    expect(() => validateCreateAlert(withOption({ rec: "yes" }))).toThrow(/rec must be true or false/);
  });

  test("allows one recommended option and rejects two", () => {
    expect(
      validateCreateAlert({
        ...ship,
        options: [
          { id: "ship", label: "Ship it", rec: true },
          { id: "hold", label: "Hold", rec: false },
        ],
      }).options.map((option) => option.rec),
    ).toEqual([true, false]);
    expect(() =>
      validateCreateAlert({
        ...ship,
        options: [
          { id: "ship", label: "Ship it", rec: true },
          { id: "hold", label: "Hold", rec: true },
        ],
      }),
    ).toThrow(/at most one option can be recommended/);
  });
});

describe("validateAlertTiming", () => {
  const now = 1_000;

  test("rejects an expiry that is not in the future", () => {
    expect(() => validateAlertTiming({ scheduledFor: null, expiresAt: 999 }, now)).toThrow(/in the future/);
    expect(() => validateAlertTiming({ scheduledFor: null, expiresAt: 1_000 }, now)).toThrow(/in the future/);
    expect(() => validateAlertTiming({ scheduledFor: null, expiresAt: 1_001 }, now)).not.toThrow();
  });

  test("rejects an expiry at or before the scheduled time", () => {
    expect(() => validateAlertTiming({ scheduledFor: 5_000, expiresAt: 5_000 }, now)).toThrow(
      /after scheduledFor/,
    );
    expect(() => validateAlertTiming({ scheduledFor: 5_000, expiresAt: 4_000 }, now)).toThrow(
      /after scheduledFor/,
    );
    expect(() => validateAlertTiming({ scheduledFor: 5_000, expiresAt: 6_000 }, now)).not.toThrow();
  });

  test("passes when there is no expiry", () => {
    expect(() => validateAlertTiming({ scheduledFor: 5_000 }, now)).not.toThrow();
    expect(() => validateAlertTiming({ scheduledFor: null }, now)).not.toThrow();
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
