/** Dev deployment `usable-mule-44`. Override with the Expo public env vars. */
const DEV_CLOUD = "https://usable-mule-44.convex.cloud";
const DEV_SITE = "https://usable-mule-44.convex.site";

function httpsOrigin(value: string | undefined, fallback: string): string {
  const url = new URL(value?.trim() || fallback);
  if (url.protocol !== "https:") throw new Error("Convex URL must be https");
  return url.origin;
}

export const convexUrl = httpsOrigin(process.env.EXPO_PUBLIC_CONVEX_URL, DEV_CLOUD);
export const convexSiteUrl = httpsOrigin(process.env.EXPO_PUBLIC_CONVEX_SITE_URL, DEV_SITE);
