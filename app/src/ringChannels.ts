/**
 * The ringtone is part of a ringing channel's id, because Android fixes a channel's sound when the
 * channel is created. Choosing another ringtone therefore means new channels; the old ones are
 * deleted. Pure, so it can be unit-tested without React Native.
 */

/** A short, stable key for a ringtone URI. "d" is the phone's own ringtone (the empty URI). */
export function ringtoneKey(uri: string): string {
  if (uri === "") return "d";
  // FNV-1a over the URI, in base 36.
  let hash = 0x811c9dc5;
  for (let i = 0; i < uri.length; i += 1) {
    hash ^= uri.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** `base` is a channel id without the ringtone (`puck-urgent-dnd-card`); the result carries it. */
export function ringChannelId(base: string, ringtone: string): string {
  return `${base}-r${ringtoneKey(ringtone)}`;
}

/** The channels that ring: `puck-alerts` for normal alerts, `puck-urgent...` for urgent ones, with or without the card. */
const WITH_RINGTONE = /^(puck-alerts|puck-urgent(?:-dnd|-alarm|-bypass)?)(?:-card)?-r([0-9a-z]+)$/;
/** The same ids before the ringtone was part of them. `puck-alerts` itself is kept: a push that Android shows by itself uses it. */
const LEGACY = /^(?:puck-alerts-card|puck-urgent(?:-dnd|-alarm|-bypass)?(?:-card)?)$/;

/**
 * Which of the phone's channels to delete after a ringtone changed: ringing channels made for a
 * ringtone that is no longer in use (the global ones and each bot's own count as in use), and the
 * ones from before the ringtone was chosen here. Channels that do not ring
 * (the quiet ones) and `puck-alerts` are never listed.
 */
export function staleRingChannelIds(
  existing: readonly string[],
  ringtones: { normal: readonly string[]; urgent: readonly string[] },
): string[] {
  const keep = {
    normal: new Set(ringtones.normal.map(ringtoneKey)),
    urgent: new Set(ringtones.urgent.map(ringtoneKey)),
  };
  return existing.filter((id) => {
    if (LEGACY.test(id)) return true;
    const match = WITH_RINGTONE.exec(id);
    if (!match) return false;
    const kind = match[1] === "puck-alerts" ? "normal" : "urgent";
    return !keep[kind].has(match[2]!);
  });
}
