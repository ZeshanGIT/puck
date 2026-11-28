import { describe, expect, test } from "bun:test";
import { DEV_CONVEX_SITE_URL, DEV_CONVEX_URL, readProfile, resolveEndpoints } from "./buildProfile";

const PROD = {
  profile: "prod",
  convexUrl: "https://happy-otter-123.convex.cloud",
  convexSiteUrl: "https://happy-otter-123.convex.site",
  clerkFrontendApi: "in-lemming-9901.clerk.accounts.dev",
  googleWebClientId: "123-abc.apps.googleusercontent.com",
};

describe("readProfile", () => {
  test("defaults to dev", () => {
    expect(readProfile(undefined)).toBe("dev");
    expect(readProfile("  ")).toBe("dev");
  });
  test("rejects unknown profiles", () => {
    expect(() => readProfile("production")).toThrow('must be "dev" or "prod"');
  });
});

describe("resolveEndpoints", () => {
  test("dev falls back to the dev deployment", () => {
    expect(resolveEndpoints({})).toEqual({
      profile: "dev",
      convexUrl: DEV_CONVEX_URL,
      convexSiteUrl: DEV_CONVEX_SITE_URL,
      clerkFrontendApi: undefined,
    });
  });

  test("dev honours overrides", () => {
    const resolved = resolveEndpoints({ convexUrl: PROD.convexUrl, convexSiteUrl: PROD.convexSiteUrl });
    expect(resolved.convexUrl).toBe(PROD.convexUrl);
    expect(resolved.convexSiteUrl).toBe(PROD.convexSiteUrl);
  });

  test("prod uses exactly what it is given", () => {
    expect(resolveEndpoints(PROD)).toEqual({
      profile: "prod",
      convexUrl: PROD.convexUrl,
      convexSiteUrl: PROD.convexSiteUrl,
      clerkFrontendApi: PROD.clerkFrontendApi,
    });
  });

  test("prod never falls back: every missing value is named", () => {
    expect(() => resolveEndpoints({ profile: "prod" })).toThrow(
      "Production build is missing EXPO_PUBLIC_CONVEX_URL, EXPO_PUBLIC_CONVEX_SITE_URL, EXPO_PUBLIC_CLERK_FRONTEND_API, EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID",
    );
    expect(() => resolveEndpoints({ ...PROD, googleWebClientId: " " })).toThrow("EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID");
  });

  test("prod refuses the dev deployment", () => {
    expect(() => resolveEndpoints({ ...PROD, convexUrl: DEV_CONVEX_URL })).toThrow("points at the dev deployment");
    expect(() => resolveEndpoints({ ...PROD, convexSiteUrl: DEV_CONVEX_SITE_URL })).toThrow("points at the dev deployment");
  });

  test("rejects non-https URLs", () => {
    expect(() => resolveEndpoints({ convexUrl: "http://example.convex.cloud" })).toThrow("must be https");
  });
});
