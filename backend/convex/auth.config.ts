import { DEVICE_JWT_AUDIENCE } from "@puck/shared";
import type { AuthConfig } from "convex/server";
import { clerkIssuer } from "./lib/clientAuth";
import { deviceJwtIssuer } from "./lib/deviceAuth";

// Convex fetches this JWKS from the deployment's `.convex.site` URL.
// The issuer string is the same one `signDeviceJwt` writes into the token.
const issuer = deviceJwtIssuer();

// Clerk session tokens for Convex use the `convex` JWT template (`aud` is `convex`).
// `requireUser` in lib/clientAuth.ts checks the same issuer.
const clerkDomain = clerkIssuer();

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
