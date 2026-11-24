import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { $ } from "bun";

if (process.platform === "darwin") {
  const source = resolve(import.meta.dir, "../../app/assets/icon.png");
  const iconset = resolve(import.meta.dir, "../icon.iconset");
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    await $ `sips -z ${size} ${size} ${source} --out ${resolve(iconset, `icon_${size}x${size}.png`)}`.quiet();
    await $ `sips -z ${size * 2} ${size * 2} ${source} --out ${resolve(iconset, `icon_${size}x${size}@2x.png`)}`.quiet();
  }
}
