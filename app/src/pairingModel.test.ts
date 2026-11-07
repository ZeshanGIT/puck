import { describe, expect, test } from "bun:test";
import {
  botNameFromId,
  codeBoxes,
  codesMatch,
  colourRow,
  cursorIndex,
  expiryText,
  findRequestByBotId,
  findRequestByCode,
  formatCode,
  fromText,
  isComplete,
  openRequests,
  PAD_LAYOUT,
  padCellKeys,
  pairingErrorText,
  pressKey,
  requestedColour,
  requestLook,
  type PairingRequest,
} from "./pairingModel";

const NOW = 1_000_000;
const MIN = 60_000;

function request(over: Partial<PairingRequest> = {}): PairingRequest {
  return {
    botId: "cortana-00042",
    name: "Cortana",
    colour: "indigo",
    addedFrom: "MacBook",
    pairingCode: "482913",
    expiresAt: NOW + 9 * MIN,
    ...over,
  };
}

describe("keypad", () => {
  test("digits add up to six and no further", () => {
    let digits = "";
    for (const key of ["4", "8", "2", "9", "1", "3", "7"] as const) digits = pressKey(digits, key);
    expect(digits).toBe("482913");
    expect(isComplete(digits)).toBe(true);
  });

  test("every cell has its own React key (the blank cell once collided with 0)", () => {
    const keys = padCellKeys();
    expect(keys).toHaveLength(PAD_LAYOUT.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every digit 0 to 9 registers", () => {
    let digits = "";
    for (const key of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const) {
      digits = pressKey(digits.length >= 6 ? "" : digits, key);
      expect(digits.endsWith(key)).toBe(true);
    }
    expect(pressKey("12345", "8")).toBe("123458");
    expect(pressKey("12345", "9")).toBe("123459");
  });

  test("back removes the last digit and does nothing on an empty entry", () => {
    expect(pressKey("48", "back")).toBe("4");
    expect(pressKey("", "back")).toBe("");
    expect(isComplete("48291")).toBe(false);
  });

  test("the boxes are three, a gap and three, with the cursor on the next one", () => {
    expect(codeBoxes("4829")).toEqual({ left: ["4", "8", "2"], right: ["9", "", ""] });
    expect(codeBoxes("")).toEqual({ left: ["", "", ""], right: ["", "", ""] });
    expect(cursorIndex("")).toBe(0);
    expect(cursorIndex("4829")).toBe(4);
    expect(cursorIndex("482913")).toBeNull();
  });

  test("the big code reads 482 913", () => {
    expect(formatCode("482913")).toBe("482 913");
    expect(formatCode("48")).toBe("48");
  });
});

describe("matching", () => {
  test("codes match with or without the space", () => {
    expect(codesMatch("482913", "482 913")).toBe(true);
    expect(codesMatch("482914", "482913")).toBe(false);
    expect(codesMatch("", "482913")).toBe(false);
  });

  test("a typed code finds the open request that has it", () => {
    const a = request();
    const b = request({ botId: "sheldon-00001", name: "Sheldon", pairingCode: "111222" });
    expect(findRequestByCode([a, b], "111222", NOW)?.name).toBe("Sheldon");
    expect(findRequestByCode([a, b], "000000", NOW)).toBeNull();
  });

  test("an expired request is not found by code or by bot id", () => {
    const old = request({ expiresAt: NOW - 1 });
    expect(findRequestByCode([old], "482913", NOW)).toBeNull();
    expect(findRequestByBotId([old], old.botId, NOW)).toBeNull();
    expect(findRequestByBotId([request()], "cortana-00042", NOW)?.name).toBe("Cortana");
    expect(findRequestByBotId([request()], "other-00001", NOW)).toBeNull();
  });
});

describe("open requests", () => {
  test("drops the expired and puts the newest first", () => {
    const soon = request({ botId: "a-00001", expiresAt: NOW + 2 * MIN });
    const later = request({ botId: "b-00002", expiresAt: NOW + 12 * MIN });
    const gone = request({ botId: "c-00003", expiresAt: NOW });
    expect(openRequests([soon, gone, later], NOW).map((r) => r.botId)).toEqual(["b-00002", "a-00001"]);
  });

  test("says how long is left", () => {
    expect(expiryText(NOW + 9 * MIN, NOW)).toBe("Expires in 9 min");
    expect(expiryText(NOW + 8 * MIN + 1, NOW)).toBe("Expires in 9 min");
    expect(expiryText(NOW + 30_000, NOW)).toBe("Expires in under a minute");
    expect(expiryText(NOW, NOW)).toBe("Expired");
  });
});

describe("how the bot looks", () => {
  test("uses the colour it asked for", () => {
    expect(requestLook(request({ colour: "coral" })).colour).toBe("coral");
    expect(colourRow(request({ colour: "coral" }))).toEqual({ name: "coral", suggested: false });
  });

  test("suggests a colour when it gave none or one that is not in the palette", () => {
    for (const colour of [null, "chartreuse"]) {
      const row = colourRow(request({ colour }));
      expect(row.suggested).toBe(true);
      expect(requestedColour(row.name)).not.toBeNull();
    }
    expect(requestedColour("chartreuse")).toBeNull();
  });

  test("the same bot always gets the same suggestion", () => {
    expect(requestLook(request({ colour: null }))).toEqual(requestLook(request({ colour: null })));
  });
});

describe("words", () => {
  test("a bot's name comes out of its id", () => {
    expect(botNameFromId("sheldon-11019")).toBe("sheldon");
    expect(botNameFromId("deploy-watch-00007")).toBe("deploy-watch");
  });

  test("from line", () => {
    expect(fromText("MacBook")).toBe("MacBook");
    expect(fromText(null)).toBe("an unnamed computer");
    expect(fromText("  ")).toBe("an unnamed computer");
  });

  test("errors read plainly", () => {
    expect(pairingErrorText("pairing code was already used")).toContain("already used");
    expect(pairingErrorText("pairing code has expired")).toContain("expired");
    expect(pairingErrorText("pairing code is not valid")).toContain("doesn't match");
    expect(pairingErrorText("pairing request is no longer open")).toContain("no longer open");
    expect(pairingErrorText("Network down")).toBe("Network down");
    expect(pairingErrorText("")).toBe("Something went wrong");
  });
});
