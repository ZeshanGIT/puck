import { ConvexReactClient } from "convex/react";
import { convexUrl } from "./deployment";

export const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
  // The inbox is only useful once the device JWT is on the socket.
  expectAuth: true,
  // Convex otherwise fetches a second token as soon as the first is accepted.
  // Each exchange replaces the device token id, so that second fetch would
  // invalidate the token the alert query is about to use.
  initialAuthTokenReuse: true,
});
