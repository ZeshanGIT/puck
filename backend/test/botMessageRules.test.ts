import { expect, test } from "bun:test";
import { botMessageAccess, takePageToken } from "../convex/lib/botMessageRules";

const bot = { userId: "owner", pairingState: "paired" as const, webhookUrl: "https://example.com" };

test("paired bots on the same account can send a webhook message", () => {
  expect(botMessageAccess(bot, { ...bot })).toBeNull();
});

test("an unowned sender must pair from a signed-in CLI", () => {
  expect(botMessageAccess({ ...bot, userId: undefined }, bot)?.error).toContain("signed-in CLI");
});

test("cross-account, unowned and unknown targets give the same rejection", () => {
  const missing = botMessageAccess(bot, null);
  expect(missing?.status).toBe(404);
  expect(botMessageAccess(bot, { ...bot, userId: "other" })).toEqual(missing);
  expect(botMessageAccess(bot, { ...bot, userId: undefined })).toEqual(missing);
  expect(botMessageAccess(bot, { ...bot, removedAt: 1 })).toEqual(missing);
  expect(botMessageAccess(bot, { ...bot, pairingState: "pending" })).toEqual(missing);
});

test("a same-account target needs a webhook", () => {
  expect(botMessageAccess(bot, { ...bot, webhookUrl: "" })?.status).toBe(409);
});

test("allows a burst of activity updates and replenishes the sender's allowance", () => {
  let bucket: ReturnType<typeof takePageToken> | undefined;
  for (let i = 0; i < 12; i++) {
    bucket = takePageToken(bucket ?? undefined, 1000);
    expect(bucket).not.toBeNull();
  }
  expect(takePageToken(bucket ?? undefined, 1000)).toBeNull();
  expect(takePageToken(bucket ?? undefined, 5999)).toBeNull();
  expect(takePageToken(bucket ?? undefined, 6000)).toEqual({ tokens: 0, at: 6000 });
});
