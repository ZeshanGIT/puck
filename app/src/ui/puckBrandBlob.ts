/**
 * The Puck wordmark blob on Home (`H1Home` header). One source for the in-app blob and launcher
 * icon artwork so shape, colour and eyes stay identical.
 */
import { EYES, EYE_GROUP_ORIGIN, EYE_GROUP_ROTATION, SAMPLE_BOTS, SHAPES, type BlobBot } from "./blobShapes";
import { PALETTE } from "./botTheme";

/** Same as `PUCK_BLOB` in Home: sky / round / 3° tilt. */
export const PUCK_HOME_BLOB: BlobBot = SAMPLE_BOTS.puck;

const SKY_FILL = PALETTE.find((entry) => entry.name === "sky")!.base;

/** SVG for the header blob and launcher icons (100×100 viewBox, no outline). */
export function puckHomeBlobIconSvg(): string {
  const { shape, tilt } = PUCK_HOME_BLOB;
  const eyes = EYES.map(
    (eye) =>
      `<rect x="${eye.x}" y="${eye.y}" width="${eye.width}" height="${eye.height}" rx="${eye.rx}" fill="#ffffff"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="rotate(${tilt} 50 50)">
    <path d="${SHAPES[shape]}" fill="${SKY_FILL}"/>
  </g>
  <g transform="rotate(${EYE_GROUP_ROTATION} ${EYE_GROUP_ORIGIN.x} ${EYE_GROUP_ORIGIN.y})">
    ${eyes}
  </g>
</svg>`;
}

/** Adaptive foreground: blob centred in the 108×108 Android safe canvas (12% inset). */
export function puckAdaptiveForegroundSvg(): string {
  const inner = puckHomeBlobIconSvg().replace(/^<\?xml[^?]*\?>\s*/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <g transform="translate(4 4) scale(1)">
    ${inner.replace(/<svg[^>]*>|<\/svg>/g, "")}
  </g>
</svg>`;
}

/** Flat background for adaptive icon (matches `app.json` `adaptiveIcon.backgroundColor`). */
export const PUCK_ADAPTIVE_ICON_BG = "#E6F4FE";
