import { anyApi } from "convex/server";
import { useConvex } from "convex/react";
import { canUseFullScreenIntent } from "puck-full-screen";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { readClientId } from "./clientStore";
import { openFullScreenSettings } from "./onboarding/fullScreenSetup";
import { readableError } from "./session";

export { openFullScreenSettings };

export function useFullScreenAccess(): { allowed: boolean | null; refresh: () => Promise<void> } {
  const client = useConvex();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const next = canUseFullScreenIntent();
    setAllowed(next);
    try {
      const clientId = await readClientId();
      if (clientId) await client.mutation(anyApi.clients.setFlags, { clientId, fullScreenAllowed: next });
      else await client.mutation(anyApi.device.setFullScreenAllowed, { allowed: next });
    } catch (error) {
      console.error(readableError(error));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return { allowed, refresh };
}
