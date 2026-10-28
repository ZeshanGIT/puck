import { DEVICE_JWT_AUDIENCE } from "@puck/shared";
import type { AuthConfig } from "convex/server";
import { deviceJwtIssuer } from "./lib/deviceAuth";

// Convex fetches this JWKS from the deployment's `.convex.site` URL.
// The issuer string is the same one `signDeviceJwt` writes into the token.
const issuer = deviceJwtIssuer();

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: DEVICE_JWT_AUDIENCE,
      issuer,
      jwks: `${issuer}/.well-known/jwks.json`,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
