import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { openRequests, type PairingRequest } from "./pairingModel";

/**
 * The signed-in user's open pairing requests (`bots.pairingRequests`), newest first, with the
 * expired ones dropped as the clock passes them. Undefined while they load; empty with no client
 * id (the legacy device path has no list).
 */
export function usePairingRequests(clientId: string | null | undefined): PairingRequest[] | undefined {
  const raw = useQuery(anyApi.bots.pairingRequests, clientId ? { clientId } : "skip") as PairingRequest[] | undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    if (clientId === null) return [];
    return raw === undefined ? undefined : openRequests(raw, now);
  }, [clientId, raw, now]);
}
