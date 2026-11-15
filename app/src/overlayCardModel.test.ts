import { describe, expect, test } from "bun:test";
import { darkTokens, lightTokens } from "./ui/tokens";
import { androidAlpha, hex6, inUsePresentation, overlayBotLook, overlayCardText, overlayPalette, shouldShowOverlayCard } from "./overlayCardModel";
import { SAMPLE_BOTS, SHAPES } from "./ui/blobShapes";

const ready = { locked: false, allowed: true, inCall: false, appOpen: false, screenOn: true };

describe("shouldShowOverlayCard", () => {
  test("an unlocked phone with the permission, the screen on and another app in front shows the card", () => {
    expect(shouldShowOverlayCard(ready)).toBe(true);
  });

  test("Puck already open (or its full-screen alert up): never a card on top of it", () => {
    expect(shouldShowOverlayCard({ ...ready, appOpen: true })).toBe(false);
  });

  test("a screen that is off gets the full-screen alert, not the card", () => {
    expect(shouldShowOverlayCard({ ...ready, screenOn: false })).toBe(false);
  });

  test("a locked phone keeps the full-screen alert, not the card", () => {
    expect(shouldShowOverlayCard({ ...ready, locked: true })).toBe(false);
  });

  test("without the permission there is only the notification", () => {
    expect(shouldShowOverlayCard({ ...ready, allowed: false })).toBe(false);
  });

  test("during a call the alert waits, as before", () => {
    expect(shouldShowOverlayCard({ ...ready, inCall: true })).toBe(false);
  });

  test("an unknown lock state never shows the card", () => {
    expect(shouldShowOverlayCard({ ...ready, locked: null })).toBe(false);
  });
});

describe("overlayCardText", () => {
  test("urgent and normal alerts are labelled apart, and show the bot and the question", () => {
    expect(overlayCardText({ priority: "urgent", botName: "Cortana", question: "Deploy now?" })).toEqual({
      label: "Urgent alert",
      title: "Cortana",
      body: "Deploy now?",
    });
    expect(overlayCardText({ priority: "normal", botName: "Cortana", question: "Lunch?" }).label).toBe("Alert");
  });
});

describe("overlayPalette", () => {
  test("uses the light or dark tokens and the urgent red only for urgent alerts", () => {
    expect(overlayPalette(false, "normal")).toEqual({
      background: lightTokens.card,
      ink: lightTokens.ink,
      ink2: lightTokens.ink2,
      accent: lightTokens.ink3,
      edge: androidAlpha(lightTokens.ink, 0.18),
    });
    expect(overlayPalette(true, "urgent").background).toBe(darkTokens.card);
    expect(overlayPalette(true, "urgent").accent).toBe(darkTokens.danger);
  });

  test("the edge is a see-through ink line, light on the dark card and red on an urgent one", () => {
    expect(overlayPalette(false, "normal").edge).toBe(`#2E${lightTokens.ink.slice(1)}`);
    expect(overlayPalette(true, "normal").edge).toBe(`#33${darkTokens.ink.slice(1)}`);
    expect(overlayPalette(true, "urgent").edge.slice(3)).toBe(hex6(darkTokens.danger).slice(1));
    // Android reads eight digits as #AARRGGBB.
    for (const dark of [false, true]) {
      for (const priority of ["normal", "urgent"] as const) {
        expect(overlayPalette(dark, priority).edge).toMatch(/^#[0-9A-Fa-f]{8}$/);
      }
    }
  });
});

describe("androidAlpha", () => {
  test("puts the alpha first and widens short colours", () => {
    expect(androidAlpha("#fff", 1)).toBe("#FFffffff");
    expect(androidAlpha("#123456", 0)).toBe("#00123456");
    expect(androidAlpha("#123456", 0.5)).toBe("#80123456");
  });
});

describe("overlayBotLook", () => {
  test("carries the bot's blob, its colours and the screen the card grows into", () => {
    const light = overlayBotLook(SAMPLE_BOTS.puck, false);
    expect(light.blobPath).toBe(SHAPES.round);
    expect(light.blobTilt).toBe(3);
    expect(light.botColour).toBe("#3d8fd6");
    expect(light.screen).toBe(lightTokens.bg);
    expect(light.blobRim).toBe("");
    expect(overlayBotLook(SAMPLE_BOTS.puck, true).screen).toBe(darkTokens.bg);
  });

  test("the black bot gets a light rim and a dark body on dark surfaces only", () => {
    expect(overlayBotLook(SAMPLE_BOTS.grok, false).blobRim).toBe("");
    const dark = overlayBotLook(SAMPLE_BOTS.grok, true);
    expect(dark.blobRim).not.toBe("");
    expect(dark.blobFill).not.toBe("#111111");
  });
});

describe("every colour the card gets is one Android can parse", () => {
  const parseable = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  test("for every sample bot, light and dark", () => {
    for (const bot of Object.values(SAMPLE_BOTS)) {
      for (const dark of [false, true]) {
        const look = overlayBotLook(bot, dark);
        for (const colour of [look.botColour, look.botDeep, look.onBot, look.blobFill, look.screen]) {
          expect(colour).toMatch(parseable);
        }
        if (look.blobRim) expect(look.blobRim).toMatch(parseable);
        const palette = overlayPalette(dark, "urgent");
        for (const colour of Object.values(palette)) expect(colour).toMatch(parseable);
      }
    }
  });

  test("hex6 expands short codes and leaves others alone", () => {
    expect(hex6("#fff")).toBe("#ffffff");
    expect(hex6("#0a3")).toBe("#00aa33");
    expect(hex6("#3d8fd6")).toBe("#3d8fd6");
  });
});

describe("inUsePresentation", () => {
  const inUse = { locked: false, allowed: true, inCall: false, appOpen: false, screenOn: true };

  test("the card by default, the whole screen when chosen", () => {
    expect(inUsePresentation(inUse, false)).toBe("card");
    expect(inUsePresentation(inUse, true)).toBe("fullScreen");
  });

  test("neither when the card could not show either", () => {
    for (const change of [{ locked: true }, { locked: null }, { allowed: false }, { inCall: true }, { appOpen: true }, { screenOn: false }]) {
      expect(inUsePresentation({ ...inUse, ...change }, true)).toBe("none");
      expect(inUsePresentation({ ...inUse, ...change }, false)).toBe("none");
    }
  });
});
