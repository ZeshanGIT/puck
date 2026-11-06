/**
 * Samples for the pairing screens (B3, B4, B5), with no backend: `puck://dev-alert?sample=<name>`
 * (dev builds only, see `App.tsx`). They run the real flow (`PairingHost`) on fake requests:
 *
 * - `pair-code`: B3, the keypad. Type `482913` to reach B4 (no code shown, you typed it); any other
 *   six digits are tried as a code for a request that is not on the account, and fail.
 * - `pair-approve`: B4 for Cortana (indigo, from MacBook, code 482 913). Approve takes two taps and
 *   goes to B5; Reject closes.
 * - `pair-approve-nocolour`: B4 for a bot that gave no colour (Puck suggests one).
 * - `pair-meet`: B5, Cortana can page you now.
 * - `home-pairing`: H1 Home with a PAIRING card first in "Needs you" (a home sample, see `home.ts`).
 *
 * Times are relative to the moment a sample is opened; `freshPairing` turns them into real times.
 */
import type { PairingRequest } from "../../../pairingModel";
import { SAMPLE_BOTS, type BlobBot } from "../../../ui/blobShapes";
import type { PairingStart } from "../../PairingHost";

const MINUTE = 60 * 1000;

export const PAIRING_SAMPLE_NAMES = ["pair-code", "pair-approve", "pair-approve-nocolour", "pair-meet"] as const;

export function isPairingSample(name: string): boolean {
  return (PAIRING_SAMPLE_NAMES as readonly string[]).includes(name);
}

/** Cortana, the prototype's pairing bot: indigo, from the MacBook, code 482 913. */
export function cortanaRequest(now: number): PairingRequest {
  return {
    botId: "cortana-00042",
    name: "Cortana",
    colour: "indigo",
    addedFrom: "MacBook",
    pairingCode: "482913",
    expiresAt: now + 9 * MINUTE,
  };
}

/** A bot that gave no colour with `puck add`. */
export function plainRequest(now: number): PairingRequest {
  return {
    botId: "brow-00007",
    name: "Brow",
    colour: null,
    addedFrom: null,
    pairingCode: "715204",
    expiresAt: now + 14 * MINUTE,
  };
}

export interface PairingSample {
  requests: PairingRequest[];
  start: PairingStart;
  /** A line to show when the sample opens, saying what to try. */
  hint: string;
}

/** The named sample, or null for an unknown name. */
export function freshPairing(name: string, now: number = Date.now()): PairingSample | null {
  const cortana = cortanaRequest(now);
  switch (name) {
    case "pair-code":
      return { requests: [cortana], start: { kind: "code" }, hint: "Sample: type 482 913 for the request" };
    case "pair-approve":
      return { requests: [cortana], start: { kind: "approve", botId: cortana.botId }, hint: "Sample: tap Approve twice" };
    case "pair-approve-nocolour": {
      const plain = plainRequest(now);
      return { requests: [plain], start: { kind: "approve", botId: plain.botId }, hint: "Sample: a bot with no colour" };
    }
    case "pair-meet": {
      const bot: BlobBot = SAMPLE_BOTS.cortana;
      return { requests: [], start: { kind: "meet", bot }, hint: "Sample: Cortana can page you now" };
    }
    default:
      return null;
  }
}
