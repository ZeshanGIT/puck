import { DEV_CLERK_FRONTEND_API, DEVICE_JWT_AUDIENCE } from "@puck/shared";
import type { AuthConfig } from "convex/server";
import { deviceJwtIssuer } from "./lib/deviceAuth";

// Convex fetches this JWKS from the deployment's `.convex.site` URL.
// The issuer string is the same one `signDeviceJwt` writes into the token.
const issuer = deviceJwtIssuer();

// Clerk session tokens for Convex use the `convex` JWT template (`aud` is `convex`).
// The phone still sends the device JWT. This provider is ready for a signed-in client.
const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
const clerkDomain = (runtime.process?.env?.CLERK_FRONTEND_API_URL || `https://${DEV_CLERK_FRONTEND_API}`).replace(/\/+$/u, "");

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: DEVICE_JWT_AUDIENCE,
      issuer,
      jwks: `${issuer}/.well-known/jwks.json`,
      algorithm: "RS256",
    },
    {
      domain: clerkDomain,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
