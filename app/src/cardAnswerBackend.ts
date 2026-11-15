/**
 * What the bottom card needs from Puck's server while Puck itself may be closed: the alert's
 * answers (the push does not carry them), fetched when the card shows. Signs the Convex client in
 * from the stored account when the app has not (a headless start), so this and the card's answers
 * go out without opening Puck.
 */
import { cardChoices, type CardChoice } from "./cardChoices";

const FETCH_TIMEOUT_MS = 8_000;

/** The alert's answers for the card, or null when they cannot be read now. Never throws. */
export async function fetchCardChoices(questionId: string): Promise<CardChoice[] | null> {
  try {
    const [{ convex }, { anyApi }, { readClientId }, { ensureBackgroundAuth }] = await Promise.all([
      import("./client"),
      import("convex/server"),
      import("./clientStore"),
      import("./clientAuth"),
    ]);
    const clientId = await readClientId();
    if (!clientId) return null;
    ensureBackgroundAuth(convex);
    const alert = (await Promise.race([
      convex.query(anyApi.alerts.get, { clientId, questionId }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
    ])) as { selectionMode: string; options: { id: string; label: string; tone?: string | null }[] } | null;
    return alert ? cardChoices(alert) : null;
  } catch {
    return null;
  }
}
