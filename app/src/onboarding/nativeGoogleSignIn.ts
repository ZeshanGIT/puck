import { requireOptionalNativeModule } from "expo-modules-core";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { googleWebClientId } from "./googleClientIds";

type OneTapSuccess = {
  type: "success";
  data: { idToken: string };
};

type OneTapCancelled = { type: "cancelled"; data: null };

type OneTapResponse = OneTapSuccess | OneTapCancelled | { type: string; data: unknown };

type NativeGoogleModule = {
  configure(params: { webClientId: string; hostedDomain?: string; autoSelectEnabled?: boolean }): void;
  presentExplicitSignIn(params: { nonce: string } | null): Promise<OneTapResponse>;
};

const native = requireOptionalNativeModule<NativeGoogleModule>("ClerkGoogleSignIn");

export class NativeGoogleSignInError extends Error {
  readonly kind: "unavailable" | "misconfigured" | "cancelled" | "failed";

  constructor(message: string, kind: NativeGoogleSignInError["kind"]) {
    super(message);
    this.name = "NativeGoogleSignInError";
    this.kind = kind;
  }
}

export async function requestGoogleIdToken(): Promise<string> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    throw new NativeGoogleSignInError("Google sign-in is only available on Android and iOS", "unavailable");
  }
  if (!native) {
    throw new NativeGoogleSignInError(
      "Native Google sign-in is not in this build. Reinstall the dev client after adding @clerk/expo-google-signin.",
      "unavailable",
    );
  }
  const webClientId = googleWebClientId();
  if (!webClientId) {
    throw new NativeGoogleSignInError(
      "Set EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID to your Google Cloud web client ID.",
      "misconfigured",
    );
  }
  native.configure({ webClientId });
  const nonce = Crypto.randomUUID();
  let response: OneTapResponse;
  try {
    response = await native.presentExplicitSignIn({ nonce });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";
    if (code === "SIGN_IN_CANCELLED" || code === "-5") {
      throw new NativeGoogleSignInError("Sign-in was cancelled", "cancelled");
    }
    throw new NativeGoogleSignInError("Google sign-in failed", "failed");
  }
  if (response.type === "cancelled") {
    throw new NativeGoogleSignInError("Sign-in was cancelled", "cancelled");
  }
  if (response.type !== "success") {
    throw new NativeGoogleSignInError("Google did not return an ID token", "failed");
  }
  const success = response as OneTapSuccess;
  const idToken = success.data.idToken;
  if (!idToken) {
    throw new NativeGoogleSignInError("Google did not return an ID token", "failed");
  }
  return idToken;
}
