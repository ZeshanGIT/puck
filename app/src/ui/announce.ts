/**
 * Screen reader announcements for alerts that arrive while the app is open (TalkBack reads
 * them aloud; with no screen reader on they do nothing). Spoken once per alert.
 */
import { useEffect, useRef } from "react";
import { AccessibilityInfo } from "react-native";
import { type AnnouncedAlert, alertAnnouncement } from "./alertAnnouncement";

/**
 * Announces the alerts in `items` that have not been announced before, once each. `waiting` is how
 * many alerts are on screen (a stack). Nothing is spoken for an empty list or for ids already seen.
 */
export function useAnnounceNewAlerts(items: ReadonlyArray<AnnouncedAlert & { id: string }>, waiting?: number): void {
  const seen = useRef(new Set<string>());
  const key = items.map((item) => item.id).join("|");
  useEffect(() => {
    const fresh = items.filter((item) => !seen.current.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) seen.current.add(item.id);
    AccessibilityInfo.announceForAccessibility(alertAnnouncement(fresh, waiting ?? fresh.length));
    // `key` stands for `items`: announce when the set of ids changes, not on every new array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
