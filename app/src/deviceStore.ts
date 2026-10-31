import * as SecureStore from "expo-secure-store";

const DEVICE_SECRET_KEY = "puck.deviceSecret";

export function readDeviceSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_SECRET_KEY);
}

export function saveDeviceSecret(secret: string): Promise<void> {
  return SecureStore.setItemAsync(DEVICE_SECRET_KEY, secret);
}
