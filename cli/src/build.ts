import pkg from "../package.json" with { type: "json" };

/**
 * Values the release build bakes in with `bun build --define` (see scripts/build-release.ts).
 * A source run (`bun run dev`) has none of them: it needs PUCK_DEPLOYMENT_URL or config.json, as before.
 */
declare const PUCK_BUILD_PROFILE: string;
declare const PUCK_BUILD_VERSION: string;
declare const PUCK_BUILD_DEPLOYMENT_URL: string;
declare const PUCK_BUILD_SITE_URL: string;
declare const PUCK_BUILD_CLERK_FRONTEND_API: string;

export interface BuildDefaults {
  profile: string;
  deploymentUrl: string;
  siteUrl: string;
  clerkFrontendApi: string;
}

function baked(): BuildDefaults | undefined {
  if (typeof PUCK_BUILD_PROFILE === "undefined") return undefined;
  return {
    profile: PUCK_BUILD_PROFILE,
    deploymentUrl: typeof PUCK_BUILD_DEPLOYMENT_URL === "undefined" ? "" : PUCK_BUILD_DEPLOYMENT_URL,
    siteUrl: typeof PUCK_BUILD_SITE_URL === "undefined" ? "" : PUCK_BUILD_SITE_URL,
    clerkFrontendApi: typeof PUCK_BUILD_CLERK_FRONTEND_API === "undefined" ? "" : PUCK_BUILD_CLERK_FRONTEND_API,
  };
}

export const buildDefaults: BuildDefaults | undefined = baked();

/** `0.1.0 (prod)` for a release binary, `0.1.0 (source)` otherwise. */
export const versionLine = `${typeof PUCK_BUILD_VERSION === "undefined" ? pkg.version : PUCK_BUILD_VERSION} (${
  buildDefaults?.profile ?? "source"
})`;
