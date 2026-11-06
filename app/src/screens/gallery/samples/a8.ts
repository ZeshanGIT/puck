/**
 * Sample groups for A8 (the stack): `puck://dev-alert?sample=three-at-once` (dev builds only, see
 * `App.tsx`) shows several alerts as one stack. `three-at-once` is the prototype's "Three at once"
 * scenario (`SIM.three` in `vault/Projects/Puck/mockups/Puck prototype.html`): Deploy Watch's urgent
 * swipe (`errors`), Sheldon's single choice (`ship`, 12 min ago) and Brow's multi choice (`tidy`,
 * 20 min ago). The alerts themselves are the A1, A2 and A3 samples, so they stay in step with them.
 * `three-with-cancel` is the same three with Brow's cancelled 6 s in (a dev-only check of the gone card).
 *
 * Times are relative to the moment the group is opened. In a stored group `createdAt` is the
 * alert's AGE in ms (so the stack can order by it), and `expiresAt` is its whole life in ms as in
 * the single samples. `freshGroup()` turns both into real times.
 */
import type { PendingAlert } from "../../../ChoiceScreen";
import { sheldon } from "./a1";
import { browMulti } from "./a2";
import { deployWatch } from "./a3";

const MINUTE_MS = 60 * 1000;

/** Listed in the prototype's order (`errors`, `ship`, `tidy`); the stack orders them itself. */
const THREE_AT_ONCE: PendingAlert[] = [
  { ...deployWatch, createdAt: 0 },
  { ...sheldon, createdAt: 12 * MINUTE_MS },
  { ...browMulti, createdAt: 20 * MINUTE_MS },
];

export const ALERT_SAMPLE_GROUPS: Record<string, PendingAlert[]> = {
  "three-at-once": THREE_AT_ONCE,
  // The same three; `App.tsx` has Brow cancel its card a few seconds in, to see a card that is gone.
  "three-with-cancel": THREE_AT_ONCE,
};

/**
 * The named group with its times moved to `now`: each `createdAt` (an age) becomes `now` minus
 * that age, and `expiresAt` (a duration) becomes `now` plus that duration. Null for an unknown name.
 */
export function freshGroup(name: string, now: number = Date.now()): PendingAlert[] | null {
  const group = ALERT_SAMPLE_GROUPS[name];
  if (!group) return null;
  return group.map((sample) => ({
    ...sample,
    createdAt: now - sample.createdAt,
    ...(sample.expiresAt === undefined ? {} : { expiresAt: now + sample.expiresAt }),
  }));
}
