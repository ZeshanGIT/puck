import { describe, expect, test } from "bun:test";
import { PUCK_HOME_BLOB, PUCK_ADAPTIVE_ICON_BG, puckAdaptiveForegroundSvg, puckHomeBlobIconSvg } from "./puckBrandBlob";
import { SHAPES } from "./blobShapes";

describe("puckHomeBlobIconSvg", () => {
  test("matches the Home header Puck blob", () => {
    expect(PUCK_HOME_BLOB).toEqual({ name: "Puck", colour: "sky", shape: "round", tilt: 3 });
    const svg = puckHomeBlobIconSvg();
    expect(svg).toContain(SHAPES.round);
    expect(svg).toContain('fill="#3d8fd6"');
    expect(svg).toContain('rotate(3 50 50)');
    expect(svg).toContain('fill="#ffffff"');
  });

  test("adaptive foreground keeps the same body path", () => {
    expect(puckAdaptiveForegroundSvg()).toContain(SHAPES.round);
    expect(PUCK_ADAPTIVE_ICON_BG).toBe("#E6F4FE");
  });
});
