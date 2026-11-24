import { expect, test } from "bun:test";
import { botMessageAccess } from "../convex/lib/botMessageRules";

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
