import { ConvexReactClient } from "convex/react";
import { convexUrl } from "./deployment";

export const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
  // Queries and mutations wait for `setAuth` (see clientAuth.ts), so nothing goes out
  // unauthenticated while the Clerk token is being fetched.
  expectAuth: true,
});
