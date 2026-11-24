import { Utils } from "electrobun/bun";
import { clerkFrontendApi } from "@puck/shared";
import { runClerkLogin } from "@puck/client/loopback";
import { SessionKeychain } from "./keychain";

const deployment = new URL(process.env.PUCK_CONVEX_URL?.trim() || "https://usable-mule-44.convex.cloud");
if (deployment.protocol !== "https:" || deployment.username || deployment.password) {
  throw new Error("Puck requires an HTTPS Convex deployment URL.");
}

export const convexUrl = deployment.origin;
export const frontendApi = clerkFrontendApi(process.env.PUCK_CLERK_FRONTEND_API);
export const keychain = new SessionKeychain(frontendApi, convexUrl);

export const timedFetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const timeout = AbortSignal.timeout(15_000);
    return fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  },
  { preconnect: fetch.preconnect },
) satisfies typeof fetch;

export function signInWithBrowser() {
  return runClerkLogin({ frontendApi, fetchImpl: timedFetch, open: Utils.openExternal });
}
