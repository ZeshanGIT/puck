import * as SecureStore from "expo-secure-store";

const CLIENT_ID_KEY = "puck.clientId";

/** The Convex id of this install's `clients` row, once it has registered. */
export function readClientId(): Promise<string | null> {
  return SecureStore.getItemAsync(CLIENT_ID_KEY);
}

export function saveClientId(clientId: string): Promise<void> {
  return SecureStore.setItemAsync(CLIENT_ID_KEY, clientId);
}

export function clearClientId(): Promise<void> {
  return SecureStore.deleteItemAsync(CLIENT_ID_KEY);
}
