/** Web OAuth client ID from Google Cloud Console (type Web application). Required for native Google sign-in. */
export function googleWebClientId(): string {
  return (process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID ?? "").trim();
}
