import { anyApi } from "convex/server";
import { useQueries, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { departedActivities, endedState, ENDED_CARD_MS, type LiveActivity } from "./liveCardModel";

/**
 * The "Working now" cards (H5): the signed-in user's running activities (`live.forUser`), oldest
 * first. When one leaves that list it stays for `ENDED_CARD_MS` as an ended card (a tick and
 * "Finished"), its end read from `live.forBot` so a failed or stopped task is not called finished;
 * if the bot started a newer task meanwhile, or nothing is known, it just goes. Undefined while
 * loading, and with no client id (the legacy device path has no list).
 */
export function useLiveActivities(clientId: string | null | undefined): LiveActivity[] | undefined {
  const running = useQuery(anyApi.live.forUser, clientId ? { clientId } : "skip") as LiveActivity[] | undefined;
  const before = useRef<LiveActivity[]>([]);
  const [departed, setDeparted] = useState<LiveActivity[]>([]);

  useEffect(() => {
    if (running === undefined) return;
    const left = departedActivities(before.current, running);
    before.current = running;
    if (left.length === 0) return;
    setDeparted((all) => [...all.filter((a) => !left.some((l) => l.activityId === a.activityId)), ...left]);
    const ids = left.map((a) => a.activityId);
    const timer = setTimeout(() => setDeparted((all) => all.filter((a) => !ids.includes(a.activityId))), ENDED_CARD_MS);
    return () => clearTimeout(timer);
  }, [running]);

  const lookups = useMemo(() => {
    const queries: Record<string, { query: typeof anyApi.live.forBot; args: { clientId: string; botId: string } }> = {};
    if (clientId) for (const a of departed) queries[a.activityId] = { query: anyApi.live.forBot, args: { clientId, botId: a.botId } };
    return queries;
  }, [clientId, departed]);
  const ended = useQueries(lookups);

  return useMemo(() => {
    if (running === undefined) return undefined;
    const finished: LiveActivity[] = [];
    for (const a of departed) {
      const current = ended[a.activityId] as LiveActivity | null | undefined | Error;
      const view = current instanceof Error ? null : current;
      if (view && endedState(a, view) !== null) finished.push(view);
    }
    return [...running, ...finished];
  }, [running, departed, ended]);
}
