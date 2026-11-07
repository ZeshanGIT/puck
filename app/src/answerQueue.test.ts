import { describe, expect, test } from "bun:test";
import {
  QUEUE_MAX_AGE_MS,
  QUEUE_MAX_FAILURES,
  QUEUE_MAX_ITEMS,
  addToQueue,
  clearAnswerQueue,
  dropExpired,
  enqueueAnswer,
  flushAnswerQueue,
  isAnswerQueued,
  isQueuedLocally,
  isPermanentAnswerError,
  loadAnswerQueue,
  nextToSend,
  noteFailure,
  parseQueue,
  removeFromQueue,
  submitOrQueue,
  type QueueStorage,
  type QueuedAnswer,
} from "./answerQueue";

const NOW = 1_700_000_000_000;

function item(id: string, queuedAt = NOW, extra: Partial<QueuedAnswer> = {}): QueuedAnswer {
  return { questionId: `q_${id}`, optionIds: ["ship"], queuedAt, ...extra };
}

function memoryStorage(initial: QueuedAnswer[] = []): QueueStorage & { raw: () => string | null } {
  let value: string | null = initial.length > 0 ? JSON.stringify(initial) : null;
  return {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    raw: () => value,
  };
}

describe("addToQueue", () => {
  test("appends, and a second answer to the same question replaces the first", () => {
    const first = addToQueue([], item("A"));
    const second = addToQueue(first, item("B"));
    expect(second.map((entry) => entry.questionId)).toEqual(["q_A", "q_B"]);
    const replaced = addToQueue(second, item("A", NOW + 5, { optionIds: ["wait"] }));
    expect(replaced.map((entry) => entry.questionId)).toEqual(["q_B", "q_A"]);
    expect(replaced[1]?.optionIds).toEqual(["wait"]);
  });

  test("keeps the newest answers past the cap", () => {
    let queue: QueuedAnswer[] = [];
    for (let index = 0; index < QUEUE_MAX_ITEMS + 3; index++) queue = addToQueue(queue, item(String(index), NOW + index));
    expect(queue).toHaveLength(QUEUE_MAX_ITEMS);
    expect(queue[0]?.questionId).toBe("q_3");
  });
});

describe("dropExpired and nextToSend", () => {
  test("drops an answer whose alert expired or that is older than a day", () => {
    const queue = [
      item("OLD", NOW - QUEUE_MAX_AGE_MS),
      item("GONE", NOW - 1000, { expiresAt: NOW }),
      item("LIVE", NOW - 1000, { expiresAt: NOW + 1000 }),
      item("PLAIN", NOW - 1000),
    ];
    expect(dropExpired(queue, NOW).map((entry) => entry.questionId)).toEqual(["q_LIVE", "q_PLAIN"]);
  });

  test("picks the oldest answer that has not expired", () => {
    const queue = [item("B", NOW - 10), item("A", NOW - 50), item("X", NOW - 99, { expiresAt: NOW - 1 })];
    expect(nextToSend(queue, NOW)?.questionId).toBe("q_A");
    expect(nextToSend([], NOW)).toBeNull();
    expect(nextToSend([item("X", NOW - 99, { expiresAt: NOW - 1 })], NOW)).toBeNull();
  });

  test("removeFromQueue removes by question", () => {
    expect(removeFromQueue([item("A"), item("B")], "q_A").map((entry) => entry.questionId)).toEqual(["q_B"]);
  });
});

describe("noteFailure", () => {
  test("counts failures and drops the item at the limit", () => {
    let queue = [item("A"), item("B")];
    for (let index = 1; index < QUEUE_MAX_FAILURES; index++) {
      queue = noteFailure(queue, "q_A");
      expect(queue.find((entry) => entry.questionId === "q_A")?.failures).toBe(index);
    }
    queue = noteFailure(queue, "q_A");
    expect(queue.map((entry) => entry.questionId)).toEqual(["q_B"]);
  });
});

describe("isPermanentAnswerError", () => {
  test("recognises what answers.record throws", () => {
    for (const message of [
      "alert is already answered",
      "alert is cancelled",
      "alert has expired",
      "alert not found",
      "[CONVEX M(answers:record)] Uncaught Error: unknown option id ship",
    ]) {
      expect(isPermanentAnswerError(message)).toBe(true);
    }
  });

  test("other failures might be temporary", () => {
    for (const message of ["Server Error", "network request failed", "unauthorized", ""]) {
      expect(isPermanentAnswerError(message)).toBe(false);
    }
  });
});

describe("parseQueue", () => {
  test("reads a stored queue and survives garbage", () => {
    const queue = [item("A", NOW, { customReply: "hi", expiresAt: NOW + 5, failures: 2 })];
    expect(parseQueue(JSON.stringify(queue))).toEqual(queue);
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("{nope")).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
    expect(parseQueue('[1,{"questionId":"q_A"},{"questionId":"q_B","optionIds":["x"],"queuedAt":5}]')).toEqual([
      { questionId: "q_B", optionIds: ["x"], queuedAt: 5 },
    ]);
  });
});

describe("enqueueAnswer and flushAnswerQueue", () => {
  test("keeps an answer on the phone and reports it as queued", async () => {
    const storage = memoryStorage();
    await enqueueAnswer(item("A"), storage);
    expect(await isAnswerQueued("q_A", storage)).toBe(true);
    expect(await isAnswerQueued("q_B", storage)).toBe(false);
    expect((await loadAnswerQueue(storage)).map((entry) => entry.questionId)).toEqual(["q_A"]);
  });

  test("remembers in memory which questions are queued, until they are sent", async () => {
    const storage = memoryStorage();
    await enqueueAnswer(item("MEM"), storage);
    expect(isQueuedLocally("q_MEM")).toBe(true);
    expect(isQueuedLocally("q_OTHER")).toBe(false);
    await flushAnswerQueue(async () => {}, { storage, now: () => NOW });
    expect(isQueuedLocally("q_MEM")).toBe(false);
  });

  test("sends in order and empties the queue", async () => {
    const storage = memoryStorage([item("B", NOW - 10), item("A", NOW - 50)]);
    const sent: string[] = [];
    const told: string[] = [];
    const result = await flushAnswerQueue(async (entry) => void sent.push(entry.questionId), {
      storage,
      now: () => NOW,
      onSent: (entry) => told.push(entry.questionId),
    });
    expect(sent).toEqual(["q_A", "q_B"]);
    expect(told).toEqual(["q_A", "q_B"]);
    expect(result).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(await loadAnswerQueue(storage)).toEqual([]);
  });

  test("drops expired answers without sending them", async () => {
    const storage = memoryStorage([item("OLD", NOW - QUEUE_MAX_AGE_MS), item("A", NOW - 5)]);
    const sent: string[] = [];
    const result = await flushAnswerQueue(async (entry) => void sent.push(entry.questionId), { storage, now: () => NOW });
    expect(sent).toEqual(["q_A"]);
    expect(result).toEqual({ sent: 1, dropped: 1, remaining: 0 });
  });

  test("a permanent error removes the item and carries on", async () => {
    const storage = memoryStorage([item("A", NOW - 50), item("B", NOW - 10)]);
    const sent: string[] = [];
    const result = await flushAnswerQueue(
      async (entry) => {
        if (entry.questionId === "q_A") throw new Error("alert is already answered");
        sent.push(entry.questionId);
      },
      { storage, now: () => NOW },
    );
    expect(sent).toEqual(["q_B"]);
    expect(result).toEqual({ sent: 1, dropped: 1, remaining: 0 });
  });

  test("a temporary error keeps the item and the order, and counts a failure", async () => {
    const storage = memoryStorage([item("A", NOW - 50), item("B", NOW - 10)]);
    const tried: string[] = [];
    const result = await flushAnswerQueue(
      async (entry) => {
        tried.push(entry.questionId);
        throw new Error("Server Error");
      },
      { storage, now: () => NOW },
    );
    expect(tried).toEqual(["q_A"]);
    expect(result).toEqual({ sent: 0, dropped: 0, remaining: 2 });
    expect((await loadAnswerQueue(storage))[0]?.failures).toBe(1);
  });

  test("calls made during a flush share it", async () => {
    const storage = memoryStorage([item("A", NOW - 5)]);
    let calls = 0;
    const send = async () => {
      calls += 1;
    };
    const [one, two] = await Promise.all([
      flushAnswerQueue(send, { storage, now: () => NOW }),
      flushAnswerQueue(send, { storage, now: () => NOW }),
    ]);
    expect(calls).toBe(1);
    expect(one).toBe(two);
  });
});

describe("submitOrQueue", () => {
  test("sends when online", async () => {
    const storage = memoryStorage();
    const sent: string[] = [];
    const outcome = await submitOrQueue({
      online: true,
      item: item("A"),
      send: async (entry) => void sent.push(entry.questionId),
      storage,
    });
    expect(outcome).toBe("sent");
    expect(sent).toEqual(["q_A"]);
    expect(storage.raw()).toBeNull();
  });

  test("queues straight away when offline, without calling send", async () => {
    const storage = memoryStorage();
    const outcome = await submitOrQueue({
      online: false,
      item: item("A"),
      send: async () => {
        throw new Error("should not send");
      },
      storage,
    });
    expect(outcome).toBe("queued");
    expect(await isAnswerQueued("q_A", storage)).toBe(true);
  });

  test("a failed send while online throws and queues nothing", async () => {
    const storage = memoryStorage();
    await expect(
      submitOrQueue({
        online: true,
        item: item("A"),
        send: async () => {
          throw new Error("alert is already answered");
        },
        storage,
      }),
    ).rejects.toThrow("already answered");
    expect(await isAnswerQueued("q_A", storage)).toBe(false);
  });
});

describe("clearAnswerQueue", () => {
  test("empties the stored queue and the in-memory ids", async () => {
    const storage = memoryStorage([item("A", NOW - 10), item("B", NOW - 5)]);
    await loadAnswerQueue(storage);
    expect(isQueuedLocally("q_A")).toBe(true);
    await clearAnswerQueue(storage);
    expect(await loadAnswerQueue(storage)).toEqual([]);
    expect(isQueuedLocally("q_A")).toBe(false);
  });
});
