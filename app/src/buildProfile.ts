/**
 * Which backend this build talks to. Dev builds fall back to the dev deployment; a production build
 * (EXPO_PUBLIC_PUCK_PROFILE=prod, set by `bun run release:build -- --profile prod`) must name every
 * endpoint and never falls back to dev.
 */
export type BuildProfile = "dev" | "prod";

/** Dev deployment `usable-mule-44`. */
export const DEV_CONVEX_URL = "https://usable-mule-44.convex.cloud";
export const DEV_CONVEX_SITE_URL = "https://usable-mule-44.convex.site";
const DEV_DEPLOYMENT = "usable-mule-44";

export interface PublicEnv {
  profile?: string;
  convexUrl?: string;
  convexSiteUrl?: string;
  clerkFrontendApi?: string;
  googleWebClientId?: string;
}

export interface Endpoints {
  profile: BuildProfile;
  convexUrl: string;
  convexSiteUrl: string;
  /** Undefined means the shared default (the dev Clerk instance); only dev builds may leave it out. */
  clerkFrontendApi: string | undefined;
}

const PROD_REQUIRED: Array<[keyof PublicEnv, string]> = [
  ["convexUrl", "EXPO_PUBLIC_CONVEX_URL"],
  ["convexSiteUrl", "EXPO_PUBLIC_CONVEX_SITE_URL"],
  ["clerkFrontendApi", "EXPO_PUBLIC_CLERK_FRONTEND_API"],
  ["googleWebClientId", "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID"],
];

export function readProfile(raw: string | undefined): BuildProfile {
  const value = raw?.trim() || "dev";
  if (value === "dev" || value === "prod") return value;
  throw new Error(`EXPO_PUBLIC_PUCK_PROFILE must be "dev" or "prod", got "${value}"`);
}

function httpsOrigin(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must be https`);
  return url.origin;
}

export function resolveEndpoints(env: PublicEnv): Endpoints {
  const profile = readProfile(env.profile);
  const clean = (value: string | undefined) => value?.trim() || undefined;
  if (profile === "prod") {
    const missing = PROD_REQUIRED.filter(([key]) => !clean(env[key])).map(([, name]) => name);
    if (missing.length > 0) throw new Error(`Production build is missing ${missing.join(", ")}`);
  }
  const convexUrl = httpsOrigin(clean(env.convexUrl) ?? DEV_CONVEX_URL, "EXPO_PUBLIC_CONVEX_URL");
  const convexSiteUrl = httpsOrigin(clean(env.convexSiteUrl) ?? DEV_CONVEX_SITE_URL, "EXPO_PUBLIC_CONVEX_SITE_URL");
  if (profile === "prod") {
    for (const url of [convexUrl, convexSiteUrl]) {
      if (new URL(url).hostname.startsWith(`${DEV_DEPLOYMENT}.`)) {
        throw new Error(`Production build points at the dev deployment (${url})`);
      }
    }
  }
  return { profile, convexUrl, convexSiteUrl, clerkFrontendApi: clean(env.clerkFrontendApi) };
}
