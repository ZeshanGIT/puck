/**
 * Sample alerts for checking the alert screens on a device: `puck://dev-alert?sample=<name>`
 * (dev builds only, see `App.tsx`). Each alert card adds its own `samples/<id>.ts` file and
 * registers it here.
 */
import type { PendingAlert } from "../../../ChoiceScreen";
import { A1_SAMPLES } from "./a1";
import { A2_SAMPLES } from "./a2";
import { A3_SAMPLES } from "./a3";
import { A5_SAMPLES } from "./a5";
import { A7_SAMPLES } from "./a7";

export const ALERT_SAMPLES: Record<string, PendingAlert> = {
  ...A1_SAMPLES,
  ...A2_SAMPLES,
  ...A3_SAMPLES,
  ...A5_SAMPLES,
  ...A7_SAMPLES,
};

/**
 * The named sample with its times moved to `now`: `createdAt` becomes now and `expiresAt`
 * (a duration in the stored sample) becomes now plus that duration. Null for an unknown name.
 */
export function freshSample(name: string, now: number = Date.now()): PendingAlert | null {
  const sample = ALERT_SAMPLES[name];
  if (!sample) return null;
  return {
    ...sample,
    createdAt: now,
    ...(sample.expiresAt === undefined ? {} : { expiresAt: now + sample.expiresAt }),
  };
}
