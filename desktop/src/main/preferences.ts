import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Utils } from "electrobun/bun";
import { isThemePreference, type ThemePreference } from "@puck/appearance";

const directory = Utils.paths.userData;
const file = join(directory, "appearance.json");

export function readThemePreference(): ThemePreference {
  try {
    const preference = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (isThemePreference(preference)) return preference;
  } catch {
    // An absent or invalid preference follows the system.
  }
  return "system";
}

export function writeThemePreference(preference: ThemePreference): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(preference), { mode: 0o600 });
  renameSync(temporary, file);
}
