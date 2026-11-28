import { resolveEndpoints } from "./buildProfile";

/**
 * Dev builds use `usable-mule-44` unless the Expo public env vars say otherwise. Production builds
 * (EXPO_PUBLIC_PUCK_PROFILE=prod) must set every value; see buildProfile.ts.
 * Each `process.env.EXPO_PUBLIC_*` is written out in full so Expo inlines it at bundle time.
 */
export const endpoints = resolveEndpoints({
  profile: process.env.EXPO_PUBLIC_PUCK_PROFILE,
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL,
  convexSiteUrl: process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
  clerkFrontendApi: process.env.EXPO_PUBLIC_CLERK_FRONTEND_API,
  googleWebClientId: process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
});

export const convexUrl = endpoints.convexUrl;
export const convexSiteUrl = endpoints.convexSiteUrl;
