import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { requireClient } from "./lib/clientAuth";

/**
 * A one-time URL the phone POSTs a reply attachment to (Convex file storage). The response holds
 * the `storageId` to pass to `answers.record`. Only a signed-in client may upload. The 20 MB and
 * five-file limits are enforced by `answers.record` against the stored files, since the upload
 * URL itself takes any size.
 */
export const generateUploadUrl = mutationGeneric({
  args: { clientId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireClient(ctx, args.clientId);
    return await ctx.storage.generateUploadUrl();
  },
});
