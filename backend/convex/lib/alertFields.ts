import type { AlertExtras } from "@puck/shared";

const EXTRA_KEYS = [
  "message",
  "details",
  "link",
  "expiresAt",
  "ringSeconds",
  "speak",
  "bypassDnd",
  "bypassSilent",
  "requiresUnlock",
] as const;

const OPTION_KEYS = ["id", "label", "icon", "desc", "tone", "rec"] as const;

/**
 * An option as the Convex validators type it. `tone` is widened to string there (the
 * `literals()` helper in schema.ts), so this is looser than `AlertOption` from @puck/shared.
 */
export interface StoredOptionInput {
  id: string;
  label: string;
  icon?: string;
  desc?: string;
  tone?: string;
  rec?: boolean;
}

/**
 * The optional alert fields that are set on `source`. Absent or undefined fields are left out,
 * so a stored or returned alert never carries `undefined` keys.
 */
export function pickAlertExtras(source: AlertExtras): AlertExtras {
  const picked: Record<string, unknown> = {};
  for (const key of EXTRA_KEYS) {
    const value = source[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked as AlertExtras;
}

/** One option as stored: the v0 fields plus whichever optional option fields are set. */
export function storedOption(option: StoredOptionInput): StoredOptionInput {
  const stored: Record<string, unknown> = {};
  for (const key of OPTION_KEYS) {
    const value = option[key];
    if (value !== undefined) stored[key] = value;
  }
  return stored as unknown as StoredOptionInput;
}
