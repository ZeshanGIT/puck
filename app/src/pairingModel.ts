/**
 * The logic behind the pairing screens (B3 code entry, B4 approve, B5 meet), as plain TypeScript
 * with no React so it can be tested: the keypad, matching a typed code to a waiting request,
 * dropping expired requests, and the words the screens show.
 */
import type { BlobBot } from "./ui/blobShapes";
import { botLook } from "./ui/botLook";
import { PALETTE, type PaletteName } from "./ui/botTheme";

/** One open pairing request, as `bots.pairingRequests` returns it. */
export interface PairingRequest {
  botId: string;
  name: string;
  /** The palette name `puck add --colour` gave, or null when it gave none. */
  colour: string | null;
  /** The computer's name, or null. */
  addedFrom: string | null;
  /** The six digits to compare with the terminal. */
  pairingCode: string;
  /** Epoch ms when the code stops working. */
  expiresAt: number;
}

export const CODE_LENGTH = 6;

/** A keypad key: a digit, or the backspace key. */
export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "back";

/** The keypad's rows, as the prototype lays them out; `null` is the empty cell left of 0. */
export const PAD_LAYOUT: readonly (PadKey | null)[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", null, "0", "back"];

/** A React key for each keypad cell: the key itself, or `blank` for the empty cell. Always unique. */
export function padCellKeys(): string[] {
  return PAD_LAYOUT.map((key, index) => (key === null ? `blank-${index}` : key));
}

/** What the typed digits become after a key: a digit adds (up to six), back removes the last. */
export function pressKey(digits: string, key: PadKey): string {
  if (key === "back") return digits.slice(0, -1);
  return digits.length >= CODE_LENGTH ? digits : digits + key;
}

export function isComplete(digits: string): boolean {
  return /^\d{6}$/u.test(digits);
}

/** The six boxes, as `["4","8","2"]` and `["9","1",""]`: three, a gap, three. Missing digits are "". */
export function codeBoxes(digits: string): { left: string[]; right: string[] } {
  const all = Array.from({ length: CODE_LENGTH }, (_, i) => digits[i] ?? "");
  return { left: all.slice(0, 3), right: all.slice(3) };
}

/** The box with the cursor (the next digit to type), or null once all six are in. */
export function cursorIndex(digits: string): number | null {
  return digits.length < CODE_LENGTH ? digits.length : null;
}

/** "482913" as "482 913" (what the big code shows). Anything that is not six digits is left as it is. */
export function formatCode(code: string): string {
  return isComplete(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** True when the code he typed (spaces allowed) is the one shown. */
export function codesMatch(typed: string, shown: string): boolean {
  return typed.replace(/\s+/gu, "") === shown.replace(/\s+/gu, "");
}

/** Requests whose code still works at `now`, the newest first (the one that expires last). */
export function openRequests(requests: readonly PairingRequest[], now: number): PairingRequest[] {
  return requests.filter((request) => request.expiresAt > now).sort((a, b) => b.expiresAt - a.expiresAt);
}

/** The open request with this code, or null. */
export function findRequestByCode(
  requests: readonly PairingRequest[],
  code: string,
  now: number,
): PairingRequest | null {
  return openRequests(requests, now).find((request) => codesMatch(code, request.pairingCode)) ?? null;
}

/** The open request for this bot, or null. */
export function findRequestByBotId(
  requests: readonly PairingRequest[],
  botId: string,
  now: number,
): PairingRequest | null {
  return openRequests(requests, now).find((request) => request.botId === botId) ?? null;
}

/** "Expires in 9 min", "Expires in under a minute", or "Expired". */
export function expiryText(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "Expired";
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return "Expires in under a minute";
  return `Expires in ${minutes} min`;
}

function isPaletteName(value: string): value is PaletteName {
  return PALETTE.some((entry) => entry.name === value);
}

/** The colour the request asked for, or null when it gave none (or one that is not in the palette). */
export function requestedColour(colour: string | null): PaletteName | null {
  return colour !== null && isPaletteName(colour) ? colour : null;
}

/** How the bot looks: its own colour when it gave one, else the one Puck suggests (Q5). */
export function requestLook(request: Pick<PairingRequest, "botId" | "name" | "colour">): BlobBot {
  const colour = requestedColour(request.colour);
  return botLook({ botId: request.botId, botName: request.name, ...(colour === null ? {} : { colour }) });
}

/** The Colour row of B4: the name, and whether Puck suggested it because the bot gave none. */
export function colourRow(request: Pick<PairingRequest, "botId" | "name" | "colour">): {
  name: PaletteName;
  suggested: boolean;
} {
  return { name: requestLook(request).colour, suggested: requestedColour(request.colour) === null };
}

/** The bot's name out of its public id (`sheldon-11019` is "sheldon"), for a bot whose request he never saw. */
export function botNameFromId(botId: string): string {
  return botId.replace(/-\d{5}$/u, "");
}

/** The "From" line: the computer's name, or a plain word when the CLI gave none. */
export function fromText(addedFrom: string | null): string {
  return addedFrom !== null && addedFrom.trim() !== "" ? addedFrom.trim() : "an unnamed computer";
}

/** The words for an error from approving or rejecting. */
export function pairingErrorText(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("already used")) {
    return "That code was already used. If Puck isn't in your Bots list, open Bots and pair again with the same code to finish claiming it.";
  }
  if (text.includes("has expired")) {
    return "That code has expired. Run puck add again on the computer and enter the new code.";
  }
  if (text.includes("not valid") || text.includes("invalid")) {
    return "That code doesn't match a waiting request. Check the terminal, or run puck add again if it timed out.";
  }
  if (text.includes("no longer open") || text.includes("not found")) {
    return "That request is no longer open. Run puck add again.";
  }
  return message.trim() === "" ? "Something went wrong" : message;
}
