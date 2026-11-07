#!/usr/bin/env node
/**
 * Regenerate launcher PNGs from `puckBrandBlob.ts`. Run from `app/`: `bun scripts/generate-blob-icons.mjs`
 * Requires `@resvg/resvg-js` (devDependency).
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(APP, "assets");

const { puckHomeBlobIconSvg, puckAdaptiveForegroundSvg, PUCK_ADAPTIVE_ICON_BG } = await import(
  "../src/ui/puckBrandBlob.ts"
);

function png(svg, width, height, path) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  const rendered = resvg.render();
  const scale = height / rendered.height;
  const resvg2 =
    Math.abs(rendered.height - height) < 2
      ? resvg
      : new Resvg(svg, { fitTo: { mode: "height", value: height } });
  writeFileSync(path, resvg2.render().asPng());
}

const iconSvg = puckHomeBlobIconSvg();
writeFileSync(join(ASSETS, "puck-blob-icon.svg"), iconSvg);

png(iconSvg, 1024, 1024, join(ASSETS, "icon.png"));
png(puckAdaptiveForegroundSvg(), 432, 432, join(ASSETS, "android-icon-foreground.png"));

const bgSvg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="432" height="432"><rect width="432" height="432" fill="${PUCK_ADAPTIVE_ICON_BG}"/></svg>`;
png(bgSvg, 432, 432, join(ASSETS, "android-icon-background.png"));

const monoSvg = iconSvg.replace(/fill="#3d8fd6"/g, 'fill="#000000"').replace(/fill="#ffffff"/g, 'fill="#ffffff"');
png(monoSvg, 432, 432, join(ASSETS, "android-icon-monochrome.png"));

console.log("Wrote puck blob launcher assets to", ASSETS);
