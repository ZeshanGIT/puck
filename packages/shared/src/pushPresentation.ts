/** When the phone allowed full-screen intents, alerts use a data-only FCM push either priority. */
export function pushUsesFullScreenDataMessage(fullScreenAllowed: boolean): boolean {
  return fullScreenAllowed;
}
