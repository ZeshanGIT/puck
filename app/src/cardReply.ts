/**
 * A reply typed on the compact card (swipe right, type, Send), sent without opening Puck. The
 * reply is put in the answer queue first, so a failed or slow send keeps it on the phone; then the
 * queue is sent. Dependencies are injected so the logic runs without a device or the Convex client.
 */
import { enqueueAnswer, flushAnswerQueue, isAnswerQueued, type QueueStorage, type QueuedAnswer } from "./answerQueue";

/** How long one send may take before the reply stays queued (the client waits for sign-in first). */
export const CARD_REPLY_TIMEOUT_MS = 20_000;

/** What `answers.record` takes for a card reply. */
export interface CardReplyRecord {
  questionId: string;
  clientId?: string;
  optionIds: string[];
  customReply?: string;
}

export interface CardReplyDeps {
  now?: () => number;
  storage?: QueueStorage;
  clientId?: () => Promise<string | null>;
  record?: (args: CardReplyRecord) => Promise<unknown>;
}

/** The queue item for a card reply: text only, no option chosen. Empty text gives null. */
export function cardReplyItem(questionId: string, text: string, queuedAt: number): QueuedAnswer | null {
  const customReply = text.trim();
  if (!customReply) return null;
  return { questionId, optionIds: [], customReply, queuedAt };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("card reply timed out")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function defaultClientId(): Promise<string | null> {
  const { readClientId } = await import("./clientStore");
  return readClientId();
}

async function defaultRecord(args: CardReplyRecord): Promise<unknown> {
  const { convex } = await import("./client");
  const { anyApi } = await import("convex/server");
  return convex.mutation(anyApi.answers.record, args);
}

/**
 * Keeps the reply in the answer queue, then sends the queue. Resolves "sent" when the reply left
 * the queue, "queued" when it is still waiting (the next flush sends it). Throws only when the
 * queue itself cannot be written, so the caller keeps its own copy.
 */
export async function sendCardReply(input: { questionId: string; text: string }, deps: CardReplyDeps = {}): Promise<"sent" | "queued" | "empty"> {
  const now = deps.now ?? Date.now;
  const item = cardReplyItem(input.questionId, input.text, now());
  if (!item) return "empty";
  await enqueueAnswer(item, deps.storage);
  const clientId = await (deps.clientId ?? defaultClientId)();
  const record = deps.record ?? defaultRecord;
  await flushAnswerQueue(
    async (entry) => {
      await withTimeout(
        record({
          questionId: entry.questionId,
          ...(clientId ? { clientId } : {}),
          optionIds: entry.optionIds,
          ...(entry.customReply ? { customReply: entry.customReply } : {}),
        }),
        CARD_REPLY_TIMEOUT_MS,
      );
    },
    { storage: deps.storage, now },
  );
  return (await isAnswerQueued(input.questionId, deps.storage)) ? "queued" : "sent";
}

const handledNonces = new Set<number>();

/**
 * The native side hands over each reply with a unique nonce. The reply is sent or queued first and
 * only then forgotten natively, so a reply is never lost between the two. A nonce is acted on once
 * in a running app even when it arrives by both the event and the stored copy.
 */
export async function handleCardReply(
  reply: { questionId: string; text: string; nonce: number },
  clear: (nonce: number) => void,
  deps: CardReplyDeps = {},
): Promise<void> {
  const { questionId, text, nonce } = reply;
  if (nonce !== 0) {
    if (handledNonces.has(nonce)) return;
    handledNonces.add(nonce);
  }
  try {
    await sendCardReply({ questionId, text }, deps);
  } catch {
    // The queue could not be written: keep the native copy for the next start.
    if (nonce !== 0) handledNonces.delete(nonce);
    return;
  }
  if (nonce !== 0) clear(nonce);
}
