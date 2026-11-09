import { describe, expect, test } from "bun:test";
import { darkTokens, lightTokens } from "./ui/tokens";
import { hex6, overlayBotLook, overlayCardText, overlayPalette, shouldShowOverlayCard } from "./overlayCardModel";
import { SAMPLE_BOTS, SHAPES } from "./ui/blobShapes";

describe("shouldShowOverlayCard", () => {
  test("an unlocked phone with the permission shows the card", () => {
    expect(shouldShowOverlayCard({ locked: false, allowed: true, inCall: false })).toBe(true);
  });

  test("a locked phone keeps the full-screen alert, not the card", () => {
    expect(shouldShowOverlayCard({ locked: true, allowed: true, inCall: false })).toBe(false);
  });

  test("without the permission there is only the notification", () => {
    expect(shouldShowOverlayCard({ locked: false, allowed: false, inCall: false })).toBe(false);
  });

  test("during a call the alert waits, as before", () => {
    expect(shouldShowOverlayCard({ locked: false, allowed: true, inCall: true })).toBe(false);
  });

  test("an unknown lock state never shows the card", () => {
    expect(shouldShowOverlayCard({ locked: null, allowed: true, inCall: false })).toBe(false);
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
    });
    expect(overlayPalette(true, "urgent").background).toBe(darkTokens.card);
    expect(overlayPalette(true, "urgent").accent).toBe(darkTokens.danger);
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
