// Two users on one deployment (docs/multi-user.md): user B must never see, receive pushes for,
// answer, snooze, cancel, wake or read receipts of user A's alerts. Handler-level, over convex-test.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { alertsByStatusFor } from "../convex/lib/alertAccess";
import { clerkIssuer } from "../convex/lib/clientAuth";
import { hashSecret } from "../convex/lib/crypto";
import { newTest } from "./harness";

process.env.PUCK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

type T = ReturnType<typeof newTest>;
const issuer = clerkIssuer();
const NOT_FOUND = "alert not found";

interface World {
  t: T;
  a: ReturnType<T["withIdentity"]>;
  b: ReturnType<T["withIdentity"]>;
  clientA: string;
  clientA2: string;
  clientB: string;
  botA: Id<"bots">;
  botB: Id<"bots">;
}

let world: World;
let seq = 0;

async function register(user: ReturnType<T["withIdentity"]>, name: string, token: string) {
  const { clientId } = await user.mutation(api.clients.register, { name, platform: "android" });
  await user.run(async (ctx) => {
    await ctx.db.patch(clientId as Id<"clients">, { pushToken: token });
  });
  return clientId;
}

async function addBot(t: T, fields: Record<string, unknown>): Promise<Id<"bots">> {
  seq += 1;
  return await t.run(async (ctx) =>
    ctx.db.insert("bots", {
      id: `bot-${seq}`,
      name: `bot${seq}`,
      secretHash: "h",
      webhookUrl: "",
      webhookHeader: "",
      routine: "r",
      pairingState: "paired",
      createdAt: Date.now(),
      ...fields,
    } as never),
  );
}

async function addAlert(t: T, botId: Id<"bots">, fields: Record<string, unknown> = {}): Promise<{ id: Id<"alerts">; questionId: string }> {
  seq += 1;
  const questionId = `q${seq}`;
  const id = await t.run(async (ctx) =>
    ctx.db.insert("alerts", {
      questionId,
      botId,
      question: `question ${seq}`,
      priority: "normal",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
      status: "pending",
      createdAt: Date.now() + seq,
      updatedAt: Date.now(),
      ...fields,
    } as never),
  );
  return { id, questionId };
}

beforeEach(async () => {
  const t = newTest();
  const a = t.withIdentity({ subject: "user_a", issuer });
  const b = t.withIdentity({ subject: "user_b", issuer });
  const clientA = await register(a, "Pixel", "tok-a");
  const clientA2 = await register(a, "MacBook", "tok-a2");
  const clientB = await register(b, "Galaxy", "tok-b");
  const botA = await addBot(t, { userId: "user_a" });
  const botB = await addBot(t, { userId: "user_b" });
  world = { t, a, b, clientA, clientA2, clientB, botA, botB };
});

afterEach(async () => {
  await world.t.finishInProgressScheduledFunctions();
});

const questionsOf = (rows: Array<{ questionId: string }>) => rows.map((row) => row.questionId).sort();

describe("alert lists", () => {
  test("pending shows each user only their own alerts", async () => {
    const { t, a, b, clientA, clientB, botA, botB } = world;
    const qa = await addAlert(t, botA, { userId: "user_a" });
    const qb = await addAlert(t, botB, { userId: "user_b" });
    expect(questionsOf(await a.query(api.alerts.pending, { clientId: clientA }))).toEqual([qa.questionId]);
    expect(questionsOf(await b.query(api.alerts.pending, { clientId: clientB }))).toEqual([qb.questionId]);
  });

  test("an alert aimed at one client stays off the same user's other client", async () => {
    const { t, a, clientA, clientA2, botA } = world;
    const q = await addAlert(t, botA, { userId: "user_a", targetClientId: clientA });
    expect(questionsOf(await a.query(api.alerts.pending, { clientId: clientA }))).toEqual([q.questionId]);
    expect(await a.query(api.alerts.pending, { clientId: clientA2 })).toEqual([]);
    expect(await a.query(api.alerts.waiting, { clientId: clientA2 })).toEqual([]);
  });

  test("legacy rows with no userId follow their bot's owner, and unowned ones are nobody's", async () => {
    const { t, a, b, clientA, clientB, botA } = world;
    const ownerless = await addBot(t, {});
    const legacy = await addAlert(t, botA);
    await addAlert(t, ownerless);
    expect(questionsOf(await a.query(api.alerts.pending, { clientId: clientA }))).toEqual([legacy.questionId]);
    expect(await b.query(api.alerts.pending, { clientId: clientB })).toEqual([]);
    expect(await b.query(api.alerts.waiting, { clientId: clientB })).toEqual([]);
    expect(await a.query(api.alerts.waiting, { clientId: clientA })).toHaveLength(1);
  });

  test("a busy user cannot crowd another user out of a window", async () => {
    const { t, b, clientB, botA, botB } = world;
    for (let i = 0; i < 120; i++) await addAlert(t, botA, { userId: "user_a" });
    const mine = await addAlert(t, botB, { userId: "user_b" });
    expect(questionsOf(await b.query(api.alerts.pending, { clientId: clientB }))).toEqual([mine.questionId]);
    expect(questionsOf(await b.query(api.alerts.waiting, { clientId: clientB }))).toEqual([mine.questionId]);
  });

  test("waiting lists pending and snoozed alerts of the caller only", async () => {
    const { t, a, b, clientA, clientB, botA, botB } = world;
    const p = await addAlert(t, botA, { userId: "user_a" });
    const s = await addAlert(t, botA, { userId: "user_a", status: "snoozed" });
    await addAlert(t, botB, { userId: "user_b", status: "snoozed" });
    expect(questionsOf(await a.query(api.alerts.waiting, { clientId: clientA }))).toEqual([p.questionId, s.questionId].sort());
    expect(await b.query(api.alerts.waiting, { clientId: clientB })).toHaveLength(1);
  });

  test("history pages hold only the caller's finished alerts, stamped or legacy", async () => {
    const { t, a, b, clientA, clientB, botA, botB } = world;
    const stamped = await addAlert(t, botA, { userId: "user_a", status: "cancelled" });
    const legacy = await addAlert(t, botA, { status: "cancelled" });
    await addAlert(t, botA, { userId: "user_a" });
    await addAlert(t, botB, { userId: "user_b", status: "cancelled" });
    const pageA = await a.query(api.alerts.history, { clientId: clientA, paginationOpts: { numItems: 50, cursor: null } });
    expect(pageA.isDone).toBe(true);
    expect(questionsOf(pageA.page)).toEqual([stamped.questionId, legacy.questionId].sort());
    const pageB = await b.query(api.alerts.history, { clientId: clientB, paginationOpts: { numItems: 50, cursor: null } });
    expect(pageB.page).toHaveLength(1);
    expect(pageB.page.map((row) => row.questionId)).not.toContain(stamped.questionId);
  });

  test("get, state and receipt answer null for another user's alert, as for a missing one", async () => {
    const { t, a, b, clientA, clientB, botA } = world;
    const q = await addAlert(t, botA, { userId: "user_a" });
    expect(await a.query(api.alerts.get, { clientId: clientA, questionId: q.questionId })).not.toBeNull();
    expect(await a.query(api.alerts.state, { clientId: clientA, questionId: q.questionId })).not.toBeNull();
    expect(await a.query(api.answers.receipt, { clientId: clientA, questionId: q.questionId })).not.toBeNull();
    expect(await b.query(api.alerts.get, { clientId: clientB, questionId: q.questionId })).toBeNull();
    expect(await b.query(api.alerts.state, { clientId: clientB, questionId: q.questionId })).toBeNull();
    expect(await b.query(api.answers.receipt, { clientId: clientB, questionId: q.questionId })).toBeNull();
    expect(await b.query(api.alerts.get, { clientId: clientB, questionId: "nope" })).toBeNull();
  });

  test("an alert with no resolvable owner is invisible to every signed-in client", async () => {
    const { t, a, b, clientA, clientB } = world;
    const ownerless = await addBot(t, {});
    const q = await addAlert(t, ownerless);
    for (const [user, clientId] of [[a, clientA], [b, clientB]] as const) {
      expect(await user.query(api.alerts.get, { clientId, questionId: q.questionId })).toBeNull();
      expect(await user.query(api.alerts.state, { clientId, questionId: q.questionId })).toBeNull();
    }
  });

  test("only the legacy device may read ownerless alerts", async () => {
    const { t, botA } = world;
    const ownerless = await addBot(t, {});
    const orphan = await addAlert(t, ownerless);
    await addAlert(t, botA, { userId: "user_a" });
    const seen = await t.run(async (ctx) => alertsByStatusFor(ctx, { kind: "device" }, "pending", 100));
    expect(seen.map((row) => row.questionId)).toEqual([orphan.questionId]);
  });

  test("a built-in test page belongs to the target client's user, even without a stored userId", async () => {
    const { t, a, b, clientA, clientB } = world;
    const builtIn = await addBot(t, { builtIn: true, id: "puck-builtin" });
    const page = await addAlert(t, builtIn, { targetClientId: clientA });
    expect(questionsOf(await a.query(api.alerts.pending, { clientId: clientA }))).toEqual([page.questionId]);
    expect(await b.query(api.alerts.pending, { clientId: clientB })).toEqual([]);
    expect(await b.query(api.alerts.get, { clientId: clientB, questionId: page.questionId })).toBeNull();
  });

  test("bots.list counts waiting alerts per owner", async () => {
    const { t, a, b, clientA, clientB, botA, botB } = world;
    await addAlert(t, botA, { userId: "user_a" });
    await addAlert(t, botA, { userId: "user_a" });
    await addAlert(t, botB, { userId: "user_b" });
    const listA = await a.query(api.bots.list, { clientId: clientA });
    const listB = await b.query(api.bots.list, { clientId: clientB });
    expect(listA.map((bot) => bot.waitingCount)).toEqual([2]);
    expect(listB.map((bot) => bot.waitingCount)).toEqual([1]);
  });
});

describe("writes by question id", () => {
  test("answers.record: B gets the missing-alert error and nothing changes; A can answer", async () => {
    const { t, a, b, clientA, clientB, botA } = world;
    const q = await addAlert(t, botA, { userId: "user_a" });
    await expect(
      b.mutation(api.answers.record, { clientId: clientB, questionId: q.questionId, optionIds: ["yes"] }),
    ).rejects.toThrow(NOT_FOUND);
    await expect(
      b.mutation(api.answers.record, { clientId: clientB, questionId: "missing", optionIds: ["yes"] }),
    ).rejects.toThrow(NOT_FOUND);
    expect((await t.run((ctx) => ctx.db.get(q.id)))?.status).toBe("pending");
    expect(await t.run((ctx) => ctx.db.query("answers").collect())).toHaveLength(0);
    await a.mutation(api.answers.record, { clientId: clientA, questionId: q.questionId, optionIds: ["yes"] });
    expect((await t.run((ctx) => ctx.db.get(q.id)))?.status).toBe("answered");
  });

  test("answers.record on a legacy row follows the bot's owner", async () => {
    const { t, b, clientB, botA } = world;
    const q = await addAlert(t, botA);
    await expect(
      b.mutation(api.answers.record, { clientId: clientB, questionId: q.questionId, optionIds: ["yes"] }),
    ).rejects.toThrow(NOT_FOUND);
  });

  test("answers.record on an ownerless alert is refused to every signed-in user", async () => {
    const { t, a, clientA } = world;
    const q = await addAlert(t, await addBot(t, {}));
    await expect(
      a.mutation(api.answers.record, { clientId: clientA, questionId: q.questionId, optionIds: ["yes"] }),
    ).rejects.toThrow(NOT_FOUND);
  });

  test("snooze: B cannot snooze A's alert; A can", async () => {
    const { t, a, b, clientA, clientB, botA } = world;
    const q = await addAlert(t, botA, { userId: "user_a" });
    await expect(
      b.mutation(api.answers.snooze, { clientId: clientB, questionId: q.questionId, until: null }),
    ).rejects.toThrow(NOT_FOUND);
    expect((await t.run((ctx) => ctx.db.get(q.id)))?.status).toBe("pending");
    expect(await t.run((ctx) => ctx.db.query("snoozeEvents").collect())).toHaveLength(0);
    await a.mutation(api.answers.snooze, { clientId: clientA, questionId: q.questionId, until: null });
    expect((await t.run((ctx) => ctx.db.get(q.id)))?.status).toBe("snoozed");
  });

  test("retryDelivery: B gets answer not found for A's failed answer", async () => {
    const { t, a, b, clientA, clientB, botA } = world;
    const q = await addAlert(t, botA, { userId: "user_a", status: "answered" });
    const answerId = await t.run(async (ctx) =>
      ctx.db.insert("answers", {
        alertId: q.id,
        questionId: q.questionId,
        answers: [{ id: "yes", label: "Yes" }],
        customReply: null,
        source: "app",
        answeredAt: Date.now() - 60_000,
        deliveryStatus: "failed",
        deliveryAttempts: 4,
      }),
    );
    await expect(b.mutation(api.answers.retryDelivery, { clientId: clientB, answerId })).rejects.toThrow("answer not found");
    expect((await t.run((ctx) => ctx.db.get(answerId)))?.deliveryStatus).toBe("failed");
    await a.mutation(api.answers.retryDelivery, { clientId: clientA, answerId });
    expect((await t.run((ctx) => ctx.db.get(answerId)))?.deliveryStatus).toBe("pending");
  });

  test("wakeSnoozed wakes only the caller's alerts", async () => {
    const { t, a, b, clientA, clientB, botA, botB } = world;
    const mine = await addAlert(t, botA, { userId: "user_a", status: "snoozed", snoozedByClientId: clientA });
    // Even a row that wrongly names A's client as the snoozer is out of reach of B.
    const theirs = await addAlert(t, botB, { userId: "user_b", status: "snoozed", snoozedByClientId: clientA });
    expect(await b.mutation(api.alerts.wakeSnoozed, { clientId: clientB })).toEqual({ woken: 0 });
    expect((await t.run((ctx) => ctx.db.get(mine.id)))?.status).toBe("snoozed");
    expect(await a.mutation(api.alerts.wakeSnoozed, { clientId: clientA })).toEqual({ woken: 1 });
    expect((await t.run((ctx) => ctx.db.get(mine.id)))?.status).toBe("pending");
    expect((await t.run((ctx) => ctx.db.get(theirs.id)))?.status).toBe("snoozed");
  });
});

describe("built-in test pages", () => {
  test("sendTest stamps the caller's userId and never reuses or cancels another user's page", async () => {
    const { t, a, b, clientA, clientB } = world;
    const first = await a.mutation(api.alerts.sendTest, { clientId: clientA });
    const second = await b.mutation(api.alerts.sendTest, { clientId: clientB });
    expect(second.questionId).not.toBe(first.questionId);
    const rows = await t.run((ctx) => ctx.db.query("alerts").collect());
    const pageA = rows.find((row) => row.questionId === first.questionId)!;
    const pageB = rows.find((row) => row.questionId === second.questionId)!;
    expect(pageA.userId).toBe("user_a");
    expect(pageB.userId).toBe("user_b");
    expect(pageA.status).toBe("pending");
    expect(pageB.status).toBe("pending");
    // A repeat call reuses the caller's own fresh page.
    expect((await a.mutation(api.alerts.sendTest, { clientId: clientA })).questionId).toBe(first.questionId);
    // A's page is invisible to B.
    expect(await b.query(api.alerts.get, { clientId: clientB, questionId: first.questionId })).toBeNull();
  });

  test("a delayed test page replaces only the caller's own pages", async () => {
    const { t, a, b, clientA, clientB } = world;
    const pageA = await a.mutation(api.alerts.sendTest, { clientId: clientA });
    await b.mutation(api.alerts.sendTest, { clientId: clientB, delaySeconds: 30 });
    const rowA = (await t.run((ctx) => ctx.db.query("alerts").collect())).find((row) => row.questionId === pageA.questionId)!;
    expect(rowA.status).toBe("pending");
  });

  test("cancelTests cancels only the caller's pages, including legacy unstamped ones", async () => {
    const { t, a, b, clientA, clientB } = world;
    const builtIn = await addBot(t, { builtIn: true, id: "puck-builtin" });
    const legacy = await addAlert(t, builtIn, { targetClientId: clientA });
    const stamped = await addAlert(t, builtIn, { targetClientId: clientA, userId: "user_a" });
    expect(await b.mutation(api.alerts.cancelTests, { clientId: clientB })).toEqual({ cancelled: 0 });
    expect((await t.run((ctx) => ctx.db.get(legacy.id)))?.status).toBe("pending");
    expect(await a.mutation(api.alerts.cancelTests, { clientId: clientA })).toEqual({ cancelled: 2 });
    expect((await t.run((ctx) => ctx.db.get(stamped.id)))?.status).toBe("cancelled");
  });
});

describe("alert creation", () => {
  test("alerts.create writes the bot owner's userId", async () => {
    const { t, botA } = world;
    const { questionId } = await t.mutation(internal.alerts.create, {
      botDocId: botA,
      question: "Ship it?",
      priority: "normal",
      selectionMode: "single",
      presentation: "choice",
      options: [{ id: "yes", label: "Yes" }],
      scheduledFor: null,
    });
    const row = (await t.run((ctx) => ctx.db.query("alerts").collect())).find((r) => r.questionId === questionId)!;
    expect(row.userId).toBe("user_a");
  });

  test("a scheduled alert is stamped too, and an ownerless bot's alert stays unstamped", async () => {
    const { t, botB } = world;
    const when = Date.now() + 3_600_000;
    const { questionId } = await t.mutation(internal.alerts.create, {
      botDocId: botB,
      question: "Later?",
      priority: "normal",
      selectionMode: "single",
      presentation: "choice",
      options: [{ id: "yes", label: "Yes" }],
      scheduledFor: when,
    });
    const ownerless = await addBot(t, {});
    const orphan = await t.mutation(internal.alerts.create, {
      botDocId: ownerless,
      question: "Hello?",
      priority: "normal",
      selectionMode: "single",
      presentation: "choice",
      options: [{ id: "yes", label: "Yes" }],
      scheduledFor: null,
    });
    const rows = await t.run((ctx) => ctx.db.query("alerts").collect());
    expect(rows.find((r) => r.questionId === questionId)?.userId).toBe("user_b");
    expect(rows.find((r) => r.questionId === orphan.questionId)?.userId).toBeUndefined();
  });

  test("the bot's own listing is not crowded out by other bots' alerts", async () => {
    const { t, botA, botB } = world;
    for (let i = 0; i < 70; i++) await addAlert(t, botB, { userId: "user_b" });
    const mine = await addAlert(t, botA, { userId: "user_a" });
    const listed = await t.query(internal.alerts.listForBot, { botDocId: botA });
    expect(listed.map((row) => row.questionId)).toEqual([mine.questionId]);
  });
});

describe("push targets", () => {
  test("loadForPush targets only the owner's clients", async () => {
    const { t, botA, botB } = world;
    await t.run(async (ctx) => {
      await ctx.db.insert("device", { id: "dev", secretHash: "s", tokenId: "t", claimedAt: 1, pushToken: "tok-device" });
    });
    const qa = await addAlert(t, botA, { userId: "user_a" });
    const qb = await addAlert(t, botB, { userId: "user_b" });
    const pa = await t.query(internal.alerts.loadForPush, { alertId: qa.id });
    const pb = await t.query(internal.alerts.loadForPush, { alertId: qb.id });
    if (!pa.send || !pb.send) throw new Error("expected pushes");
    expect(pa.targets.map((x) => x.pushToken).sort()).toEqual(["tok-a", "tok-a2"]);
    expect(pb.targets.map((x) => x.pushToken)).toEqual(["tok-b"]);
  });

  test("a targeted alert goes to that one client of the owner", async () => {
    const { t, botA, clientA2 } = world;
    const q = await addAlert(t, botA, { userId: "user_a", targetClientId: clientA2 });
    const push = await t.query(internal.alerts.loadForPush, { alertId: q.id });
    if (!push.send) throw new Error("expected a push");
    expect(push.targets.map((x) => x.pushToken)).toEqual(["tok-a2"]);
  });

  test("a legacy unstamped alert still goes by its bot's owner", async () => {
    const { t, botB } = world;
    const q = await addAlert(t, botB);
    const push = await t.query(internal.alerts.loadForPush, { alertId: q.id });
    if (!push.send) throw new Error("expected a push");
    expect(push.targets.map((x) => x.pushToken)).toEqual(["tok-b"]);
  });

  test("a built-in test page goes to the target client only", async () => {
    const { t, clientB } = world;
    const builtIn = await addBot(t, { builtIn: true, id: "puck-builtin" });
    const q = await addAlert(t, builtIn, { targetClientId: clientB });
    const push = await t.query(internal.alerts.loadForPush, { alertId: q.id });
    if (!push.send) throw new Error("expected a push");
    expect(push.targets.map((x) => x.pushToken)).toEqual(["tok-b"]);
  });

  test("an ownerless alert goes to the legacy device only, never to a client", async () => {
    const { t } = world;
    const ownerless = await addBot(t, {});
    const q = await addAlert(t, ownerless);
    expect(await t.query(internal.alerts.loadForPush, { alertId: q.id })).toEqual({ send: false, reason: "no device token" });
    await t.run(async (ctx) => {
      await ctx.db.insert("device", { id: "dev", secretHash: "s", tokenId: "t", claimedAt: 1, pushToken: "tok-device" });
    });
    const push = await t.query(internal.alerts.loadForPush, { alertId: q.id });
    if (!push.send) throw new Error("expected a push");
    expect(push.targets.map((x) => x.pushToken)).toEqual(["tok-device"]);
  });

  test("dismiss goes to the owner's other clients, never to another user", async () => {
    const { t, botA, clientA } = world;
    const q = await addAlert(t, botA, { userId: "user_a" });
    expect(await t.query(internal.alerts.loadDismissTargets, { questionId: q.questionId })).toEqual(["tok-a", "tok-a2"]);
    expect(
      await t.query(internal.alerts.loadDismissTargets, { questionId: q.questionId, exceptClientId: clientA }),
    ).toEqual(["tok-a2"]);
  });

  test("dismiss with no or an unknown question id tells nobody", async () => {
    const { t } = world;
    expect(await t.query(internal.alerts.loadDismissTargets, {})).toEqual([]);
    expect(await t.query(internal.alerts.loadDismissTargets, { questionId: "gone" })).toEqual([]);
  });
});

describe("pairing", () => {
  const pairing = (name: string) => ({ name, webhookUrl: "", webhookHeader: "" });
  const create = (user: { mutation: T["mutation"] }, name: string) => user.mutation(api.bots.createPairing, pairing(name));

  test("the cap of pending requests is per owner, and anonymous requests have their own", async () => {
    const { t, a, b } = world;
    for (let i = 0; i < 5; i++) await create(a, `a${i}`);
    await expect(create(a, "a-extra")).rejects.toThrow("too many pending bots");
    await create(b, "b0");
    for (let i = 0; i < 5; i++) await create(t, `anon${i}`);
    await expect(create(t, "anon-extra")).rejects.toThrow("too many pending bots");
    // B and an anonymous CLI are not blocked by A's pile, and A is not blocked by theirs.
    await create(b, "b1");
  });

  test("expired and rejected requests free their slot", async () => {
    const { t, a, clientA } = world;
    for (let i = 0; i < 5; i++) await create(a, `a${i}`);
    await expect(create(a, "a-extra")).rejects.toThrow("too many pending bots");
    const rows = (await t.run((ctx) => ctx.db.query("bots").collect())).filter((bot) => bot.pairingState === "pending");
    await t.run(async (ctx) => {
      await ctx.db.patch(rows[0]!._id, { pairingCodeExpiresAt: Date.now() - 1 });
    });
    await create(a, "a-after-expiry");
    await expect(create(a, "a-extra-2")).rejects.toThrow("too many pending bots");
    await a.mutation(api.bots.rejectPairing, { clientId: clientA, botId: rows[1]!.id });
    await create(a, "a-after-reject");
  });

  test("an expired anonymous pile does not lock anonymous pairing", async () => {
    const { t } = world;
    for (let i = 0; i < 5; i++) await create(t, `anon${i}`);
    await t.run(async (ctx) => {
      for (const bot of await ctx.db.query("bots").collect()) {
        if (bot.pairingState === "pending") await ctx.db.patch(bot._id, { pairingCodeExpiresAt: Date.now() - 1 });
      }
    });
    await create(t, "anon-fresh");
  });

  test("pairingRequests lists only the caller's open requests", async () => {
    const { a, b, clientA, clientB } = world;
    await create(a, "mine");
    await create(b, "theirs");
    expect((await a.query(api.bots.pairingRequests, { clientId: clientA })).map((r) => r.name)).toEqual(["mine"]);
    expect((await b.query(api.bots.pairingRequests, { clientId: clientB })).map((r) => r.name)).toEqual(["theirs"]);
  });

  test("approval by the wrong user fails with the invalid-code error and changes nothing", async () => {
    const { t, a, b, clientA, clientB } = world;
    const { pairingCode, botId } = await create(a, "mine");
    await expect(b.mutation(api.bots.approvePairing, { clientId: clientB, pairingCode })).rejects.toThrow(
      "pairing code is not valid",
    );
    const bot = async () => (await t.run((ctx) => ctx.db.query("bots").collect())).find((row) => row.id === botId)!;
    expect((await bot()).pairingState).toBe("pending");
    expect(await a.mutation(api.bots.approvePairing, { clientId: clientA, pairingCode })).toEqual({ botId });
    const approved = await bot();
    expect(approved.pairingState).toBe("paired");
    // The code works once.
    expect(approved.pairingCodeHash).toBeUndefined();
    await expect(a.mutation(api.bots.approvePairing, { clientId: clientA, pairingCode })).rejects.toThrow(
      "pairing code is not valid",
    );
  });

  test("an unsigned request is claimed by the approving user, and its code is spent", async () => {
    const { t, b, clientB } = world;
    const { pairingCode, botId } = await create(t, "anon");
    await b.mutation(api.bots.approvePairing, { clientId: clientB, pairingCode });
    const bot = (await t.run((ctx) => ctx.db.query("bots").collect())).find((row) => row.id === botId)!;
    expect(bot.userId).toBe("user_b");
    expect(bot.pairingCodeHash).toBeUndefined();
  });

  test("adopting a paired ownerless bot spends its code, so the next user cannot take it", async () => {
    const { t, a, b, clientA, clientB } = world;
    const hash = await hashSecret("123456");
    const botId = await addBot(t, { pairingCodeHash: hash });
    await a.mutation(api.bots.approvePairing, { clientId: clientA, pairingCode: "123456" });
    const row = await t.run((ctx) => ctx.db.get(botId));
    expect(row?.userId).toBe("user_a");
    expect(row?.pairingCodeHash).toBeUndefined();
    await expect(b.mutation(api.bots.approvePairing, { clientId: clientB, pairingCode: "123456" })).rejects.toThrow(
      "pairing code is not valid",
    );
  });

  test("a rejected request cannot be rejected by another user", async () => {
    const { a, b, clientB } = world;
    const { botId } = await create(a, "mine");
    await expect(b.mutation(api.bots.rejectPairing, { clientId: clientB, botId })).rejects.toThrow("pairing request not found");
  });
});

describe("migrations", () => {
  const botIds = async (t: T, ids: Id<"bots">[]) => (await t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))))).map((bot) => bot!.id);

  test("backfillBotOwners dry run reports and writes nothing; a real run is idempotent and never overwrites", async () => {
    const { t, botA } = world;
    const loose = await addBot(t, {});
    const builtIn = await addBot(t, { builtIn: true, id: "puck-builtin" });
    const [looseId, builtInId, ownedId] = await botIds(t, [loose, builtIn, botA]);
    const args = { userId: "user_c", botIds: [looseId!, builtInId!, ownedId!, "ghost-1"] };
    const dry = await t.mutation(internal.migrations.backfillBotOwners, { ...args, dryRun: true });
    expect(dry).toEqual({
      dryRun: true,
      updated: [looseId],
      skipped: [
        { botId: builtInId, reason: "built-in bot" },
        { botId: ownedId, reason: "already has another owner" },
        { botId: "ghost-1", reason: "not found" },
      ],
    });
    expect((await t.run((ctx) => ctx.db.get(loose)))?.userId).toBeUndefined();
    const real = await t.mutation(internal.migrations.backfillBotOwners, { ...args, dryRun: false });
    expect(real.updated).toEqual([looseId]);
    expect((await t.run((ctx) => ctx.db.get(loose)))?.userId).toBe("user_c");
    expect((await t.run((ctx) => ctx.db.get(builtIn)))?.userId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(botA)))?.userId).toBe("user_a");
    const again = await t.mutation(internal.migrations.backfillBotOwners, { ...args, dryRun: false });
    expect(again.updated).toEqual([]);
    expect(again.skipped.find((s) => s.botId === looseId)?.reason).toBe("already owned by this user");
  });

  test("reassignOwner moves one user's bots, alerts and nothing else; dry run writes nothing", async () => {
    const { t, botA, botB } = world;
    const pendingB = await addBot(t, { userId: "user_b", pairingState: "pending" });
    const builtIn = await addBot(t, { builtIn: true, id: "puck-builtin" });
    const alertB = await addAlert(t, botB, { userId: "user_b" });
    const alertA = await addAlert(t, botA, { userId: "user_a" });
    const [botBId, pendingBId] = await botIds(t, [botB, pendingB]);
    const owner = async (id: Id<"bots"> | Id<"alerts">) => (await t.run((ctx) => ctx.db.get(id)))?.userId;

    const dry = await t.mutation(internal.migrations.reassignOwner, { fromUserId: "user_b", toUserId: "user_a", dryRun: true });
    expect(dry).toEqual({ dryRun: true, bots: [botBId, pendingBId].sort(), alerts: 1, moreAlerts: false, liveActivities: 0 });
    expect(await owner(botB)).toBe("user_b");
    expect(await owner(alertB.id)).toBe("user_b");

    const real = await t.mutation(internal.migrations.reassignOwner, { fromUserId: "user_b", toUserId: "user_a", dryRun: false });
    expect(real.bots).toEqual([botBId, pendingBId].sort());
    expect(await owner(botB)).toBe("user_a");
    expect(await owner(pendingB)).toBe("user_a");
    expect(await owner(alertB.id)).toBe("user_a");
    expect(await owner(alertA.id)).toBe("user_a");
    expect(await owner(builtIn)).toBeUndefined();
    const again = await t.mutation(internal.migrations.reassignOwner, { fromUserId: "user_b", toUserId: "user_a", dryRun: false });
    expect(again).toMatchObject({ bots: [], alerts: 0 });
    await expect(
      t.mutation(internal.migrations.reassignOwner, { fromUserId: "user_a", toUserId: "user_a", dryRun: true }),
    ).rejects.toThrow("the same");
  });

  test("backfillAlertOwners stamps derived owners, reports unresolved ones, and is paginated and idempotent", async () => {
    const { t, botA, botB, clientA } = world;
    const builtIn = await addBot(t, { builtIn: true, id: "puck-builtin" });
    const ownerless = await addBot(t, {});
    const forA = await addAlert(t, botA);
    const forB = await addAlert(t, botB, { status: "answered" });
    const page = await addAlert(t, builtIn, { targetClientId: clientA });
    const orphan = await addAlert(t, ownerless);
    const stamped = await addAlert(t, botA, { userId: "user_b" });

    const dry = await t.mutation(internal.migrations.backfillAlertOwners, { dryRun: true });
    expect(dry.isDone).toBe(true);
    expect(dry.updated.sort()).toEqual([forA.questionId, forB.questionId, page.questionId].sort());
    expect(dry.unresolved).toEqual([orphan.questionId]);
    expect(dry.alreadyOwned).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(forA.id)))?.userId).toBeUndefined();

    // Two pages of two, following the cursor.
    const first = await t.mutation(internal.migrations.backfillAlertOwners, { dryRun: false, numItems: 2 });
    expect(first.isDone).toBe(false);
    const second = await t.mutation(internal.migrations.backfillAlertOwners, { dryRun: false, cursor: first.continueCursor, numItems: 2 });
    const third = await t.mutation(internal.migrations.backfillAlertOwners, { dryRun: false, cursor: second.continueCursor, numItems: 2 });
    expect(third.isDone).toBe(true);
    const owner = async (id: Id<"alerts">) => (await t.run((ctx) => ctx.db.get(id)))?.userId;
    expect(await owner(forA.id)).toBe("user_a");
    expect(await owner(forB.id)).toBe("user_b");
    expect(await owner(page.id)).toBe("user_a");
    expect(await owner(orphan.id)).toBeUndefined();
    // An existing owner is never overwritten.
    expect(await owner(stamped.id)).toBe("user_b");

    const again = await t.mutation(internal.migrations.backfillAlertOwners, { dryRun: false });
    expect(again.updated).toEqual([]);
    expect(again.unresolved).toEqual([orphan.questionId]);
  });
});
