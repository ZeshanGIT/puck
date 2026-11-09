import { describe, expect, test } from "bun:test";
import { isAnswerQueued, type QueueStorage } from "./answerQueue";
import { cardReplyItem, handleCardReply, sendCardReply } from "./cardReply";

function memoryStorage(): QueueStorage & { value(): string | null } {
  let stored: string | null = null;
  return {
    async read() {
      return stored;
    },
    async write(value: string) {
      stored = value;
    },
    value() {
      return stored;
    },
  };
}

const noClient = async () => null;

describe("cardReplyItem", () => {
  test("text only, trimmed, no option", () => {
    expect(cardReplyItem("q_1", "  on my way  ", 5)).toEqual({
      questionId: "q_1",
      optionIds: [],
      customReply: "on my way",
      queuedAt: 5,
    });
  });

  test("blank text is not a reply", () => {
    expect(cardReplyItem("q_1", "   ", 5)).toBeNull();
  });
});

describe("sendCardReply", () => {
  test("sends the reply and removes it from the queue", async () => {
    const storage = memoryStorage();
    const sent: unknown[] = [];
    const result = await sendCardReply(
      { questionId: "q_1", text: "yes" },
      {
        storage,
        clientId: async () => "client_1",
        record: async (args) => {
          sent.push(args);
        },
      },
    );
    expect(result).toBe("sent");
    expect(sent).toEqual([{ questionId: "q_1", clientId: "client_1", optionIds: [], customReply: "yes" }]);
    expect(await isAnswerQueued("q_1", storage)).toBe(false);
  });

  test("keeps the reply queued when the send fails", async () => {
    const storage = memoryStorage();
    const result = await sendCardReply(
      { questionId: "q_2", text: "later" },
      {
        storage,
        clientId: noClient,
        record: async () => {
          throw new Error("network down");
        },
      },
    );
    expect(result).toBe("queued");
    expect(await isAnswerQueued("q_2", storage)).toBe(true);
  });

  test("empty text sends nothing and queues nothing", async () => {
    const storage = memoryStorage();
    let calls = 0;
    const result = await sendCardReply(
      { questionId: "q_3", text: "  " },
      {
        storage,
        clientId: noClient,
        record: async () => {
          calls += 1;
        },
      },
    );
    expect(result).toBe("empty");
    expect(calls).toBe(0);
    expect(storage.value()).toBeNull();
  });
});

describe("handleCardReply", () => {
  test("clears the native copy once the reply is sent", async () => {
    const cleared: number[] = [];
    await handleCardReply(
      { questionId: "q_4", text: "ok", nonce: 401 },
      (nonce) => cleared.push(nonce),
      { storage: memoryStorage(), clientId: noClient, record: async () => {} },
    );
    expect(cleared).toEqual([401]);
  });

  test("a nonce seen twice is handled once", async () => {
    const cleared: number[] = [];
    const deps = { storage: memoryStorage(), clientId: noClient, record: async () => {} };
    await handleCardReply({ questionId: "q_5", text: "ok", nonce: 402 }, (n) => cleared.push(n), deps);
    await handleCardReply({ questionId: "q_5", text: "ok", nonce: 402 }, (n) => cleared.push(n), deps);
    expect(cleared).toEqual([402]);
  });

  test("a failed queue write keeps the native copy", async () => {
    const cleared: number[] = [];
    const brokenStorage: QueueStorage = {
      async read() {
        return null;
      },
      async write() {
        throw new Error("disk full");
      },
    };
    await handleCardReply({ questionId: "q_6", text: "ok", nonce: 403 }, (n) => cleared.push(n), {
      storage: brokenStorage,
      clientId: noClient,
      record: async () => {},
    });
    expect(cleared).toEqual([]);
  });
});
