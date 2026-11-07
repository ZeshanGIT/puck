/**
 * A10, no network: an answer given while the Convex connection is down is kept on the phone and
 * sent when the connection returns (J11). The queue is persisted with `expo-secure-store`, like
 * the app's other stores, and survives the app being closed.
 *
 * The rules are pure functions (add, drop expired, pick the next, classify an error) so
 * `bun test` can run them. Storage is injected; the SecureStore binding loads its module only when
 * used. `flushAnswerQueue(send)` sends in order and removes an item when it is sent or can never
 * succeed (already answered, cancelled, not found, expired); a failure that might be temporary
 * stops the flush and keeps the item. The host calls it at app start and whenever the connection
 * returns (`useAnswerQueueFlush` in `screens/A10Offline.tsx`).
 */
import type { UploadedAttachment } from "./attachments";

/** One answer waiting to be sent: what `answers.record` takes, plus when it was given. */
export interface QueuedAnswer {
  questionId: string;
  optionIds: string[];
  customReply?: string;
  attachments?: UploadedAttachment[];
  /** Epoch ms the answer was given. The server's `answeredAt` is the send time (see the report). */
  queuedAt: number;
  /** The alert's `expiresAt`, when it has one: after it the answer is dropped, not sent. */
  expiresAt?: number;
  /** Failed send attempts that were not recognised as permanent. */
  failures?: number;
}

/** An answer older than this is dropped (Protocol: the alert is long gone). */
export const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** At most this many answers wait; the oldest go first. */
export const QUEUE_MAX_ITEMS = 20;
/** An item that keeps failing for a reason we cannot read is dropped after this many tries. */
export const QUEUE_MAX_FAILURES = 5;

/* --------------------------------------------------------------------- pure */

/**
 * Adds an answer. An alert can only be answered once, so a second answer for the same question
 * replaces the first. The oldest answers fall off past `QUEUE_MAX_ITEMS`.
 */
export function addToQueue(queue: readonly QueuedAnswer[], item: QueuedAnswer): QueuedAnswer[] {
  const next = [...queue.filter((entry) => entry.questionId !== item.questionId), item];
  return next.length > QUEUE_MAX_ITEMS ? next.slice(next.length - QUEUE_MAX_ITEMS) : next;
}

/** True when the alert has expired or the answer is older than a day. */
export function isExpired(item: QueuedAnswer, now: number): boolean {
  if (item.expiresAt !== undefined && now >= item.expiresAt) return true;
  return now - item.queuedAt >= QUEUE_MAX_AGE_MS;
}

/** The queue without answers whose alert expired or that are older than 24 hours. */
export function dropExpired(queue: readonly QueuedAnswer[], now: number): QueuedAnswer[] {
  return queue.filter((item) => !isExpired(item, now));
}

/** The next answer to send: the oldest one that has not expired. Null when there is none. */
export function nextToSend(queue: readonly QueuedAnswer[], now: number): QueuedAnswer | null {
  let next: QueuedAnswer | null = null;
  for (const item of queue) {
    if (isExpired(item, now)) continue;
    if (next === null || item.queuedAt < next.queuedAt) next = item;
  }
  return next;
}

export function removeFromQueue(queue: readonly QueuedAnswer[], questionId: string): QueuedAnswer[] {
  return queue.filter((item) => item.questionId !== questionId);
}

/** Records a failed attempt. The item is dropped once it has failed `QUEUE_MAX_FAILURES` times. */
export function noteFailure(queue: readonly QueuedAnswer[], questionId: string): QueuedAnswer[] {
  const next: QueuedAnswer[] = [];
  for (const item of queue) {
    if (item.questionId !== questionId) {
      next.push(item);
      continue;
    }
    const failures = (item.failures ?? 0) + 1;
    if (failures < QUEUE_MAX_FAILURES) next.push({ ...item, failures });
  }
  return next;
}

/**
 * True for an error that will not go away by trying again: the alert was answered or cancelled
 * meanwhile, it expired, it no longer exists, or the answer does not fit it. Matches the
 * messages `answers.record` throws. (A production Convex deployment may hide the text of a plain
 * `Error` behind "Server Error"; those count as failures and drop after `QUEUE_MAX_FAILURES`.)
 */
export function isPermanentAnswerError(message: string): boolean {
  return /already answered|is cancelled|has expired|alert not found|unknown option|duplicate option|too many option|single selection|choose an option/iu.test(
    message,
  );
}

/** Reads the stored queue, tolerating anything unexpected (a bad value is an empty queue). */
export function parseQueue(raw: string | null): QueuedAnswer[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: QueuedAnswer[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Partial<QueuedAnswer>;
    if (typeof item.questionId !== "string" || !Array.isArray(item.optionIds)) continue;
    if (!item.optionIds.every((id) => typeof id === "string")) continue;
    if (typeof item.queuedAt !== "number" || !Number.isFinite(item.queuedAt)) continue;
    items.push({
      questionId: item.questionId,
      optionIds: item.optionIds as string[],
      queuedAt: item.queuedAt,
      ...(typeof item.customReply === "string" ? { customReply: item.customReply } : {}),
      ...(Array.isArray(item.attachments) ? { attachments: item.attachments as UploadedAttachment[] } : {}),
      ...(typeof item.expiresAt === "number" ? { expiresAt: item.expiresAt } : {}),
      ...(typeof item.failures === "number" ? { failures: item.failures } : {}),
    });
  }
  return items;
}

/* ------------------------------------------------------------------ storage */

/** Where the queue is kept. Injected so tests need no device. */
export interface QueueStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

const QUEUE_KEY = "puck.answerQueue";

/** The app's storage for the queue: `expo-secure-store`, loaded on first use. */
export const secureQueueStorage: QueueStorage = {
  async read() {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.getItemAsync(QUEUE_KEY);
  },
  async write(value) {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(QUEUE_KEY, value);
  },
};

// The question ids in the stored queue, kept in memory so a screen can ask without waiting for
// storage. Refreshed by every read-modify-write below, so it is filled once the queue has been read
// (`useAnswerQueueFlush` does that at app start).
let queuedIds = new Set<string>();

/**
 * True while an answer for this question waits on the phone to be sent. The inbox leaves such an
 * alert out of its list, so it does not come back after the receipt closes.
 */
export function isQueuedLocally(questionId: string): boolean {
  return queuedIds.has(questionId);
}

// Reads and writes are small read-modify-write steps; this keeps two of them from interleaving.
let lock: Promise<unknown> = Promise.resolve();

function update<T>(storage: QueueStorage, change: (queue: QueuedAnswer[]) => { queue: QueuedAnswer[]; result: T }): Promise<T> {
  const run = lock.then(async () => {
    const before = parseQueue(await storage.read());
    const { queue, result } = change(before);
    if (queue !== before) await storage.write(JSON.stringify(queue));
    queuedIds = new Set(queue.map((entry) => entry.questionId));
    return result;
  });
  lock = run.catch(() => undefined);
  return run;
}

export async function loadAnswerQueue(storage: QueueStorage = secureQueueStorage): Promise<QueuedAnswer[]> {
  return update(storage, (queue) => ({ queue, result: queue }));
}

/**
 * Empties the queue. Signing out does this: the answers wait for a client row that is being removed,
 * and sending them later under a new row (or another account) would be wrong.
 */
export async function clearAnswerQueue(storage: QueueStorage = secureQueueStorage): Promise<void> {
  await update(storage, () => ({ queue: [], result: undefined }));
}

/** Keeps an answer on the phone to send later. */
export async function enqueueAnswer(item: QueuedAnswer, storage: QueueStorage = secureQueueStorage): Promise<void> {
  await update(storage, (queue) => ({ queue: addToQueue(dropExpired(queue, item.queuedAt), item), result: undefined }));
}

/** True when an answer for this question is waiting to be sent. */
export async function isAnswerQueued(questionId: string, storage: QueueStorage = secureQueueStorage): Promise<boolean> {
  return (await loadAnswerQueue(storage)).some((item) => item.questionId === questionId);
}

export type SendQueuedAnswer = (item: QueuedAnswer) => Promise<void>;

export interface FlushOptions {
  storage?: QueueStorage;
  now?: () => number;
  /** Called after an answer was sent, so the screen can move its receipt on from "Waiting for network". */
  onSent?: (item: QueuedAnswer) => void;
}

export interface FlushResult {
  sent: number;
  dropped: number;
  remaining: number;
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Sends the waiting answers in order. An item leaves the queue when `send` succeeds or throws a
 * permanent error. Any other error keeps the item (counting a failure) and ends the flush, so the
 * order is kept and the next flush tries again. Calls while a flush runs share that flush.
 */
export function flushAnswerQueue(send: SendQueuedAnswer, options: FlushOptions = {}): Promise<FlushResult> {
  if (flushing) return flushing;
  const run = doFlush(send, options).finally(() => {
    flushing = null;
  });
  flushing = run;
  return run;
}

async function doFlush(send: SendQueuedAnswer, options: FlushOptions): Promise<FlushResult> {
  const storage = options.storage ?? secureQueueStorage;
  const clock = options.now ?? Date.now;
  let sent = 0;
  let dropped = 0;
  for (;;) {
    const item = await update(storage, (queue) => {
      const live = dropExpired(queue, clock());
      dropped += queue.length - live.length;
      return { queue: live, result: nextToSend(live, clock()) };
    });
    if (item === null) break;
    try {
      await send(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isPermanentAnswerError(message)) {
        await update(storage, (queue) => ({ queue: removeFromQueue(queue, item.questionId), result: undefined }));
        dropped += 1;
        continue;
      }
      await update(storage, (queue) => ({ queue: noteFailure(queue, item.questionId), result: undefined }));
      break;
    }
    await update(storage, (queue) => ({ queue: removeFromQueue(queue, item.questionId), result: undefined }));
    sent += 1;
    options.onSent?.(item);
  }
  const remaining = (await loadAnswerQueue(storage)).length;
  return { sent, dropped, remaining };
}

/**
 * What the host does with an answer: sends it, or, with the connection down, keeps it on the
 * phone straight away instead of failing ("queued"). A send that fails while online throws, so
 * the screen can show the error and bring the options back.
 */
export async function submitOrQueue(input: {
  online: boolean;
  item: QueuedAnswer;
  send: SendQueuedAnswer;
  storage?: QueueStorage;
}): Promise<"sent" | "queued"> {
  if (!input.online) {
    await enqueueAnswer(input.item, input.storage);
    return "queued";
  }
  await input.send(input.item);
  return "sent";
}
