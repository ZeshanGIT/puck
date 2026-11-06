/**
 * A10 Couldn't send, the no-network half: knowing the connection is down, the banner, and
 * sending the waiting answers when it returns (`answerQueue.ts`). Prototype: the offline `.banner`
 * on home (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` A10, J11.
 *
 * The receipt for a queued answer is `A7Receipt` with `state="queued"`. The webhook-failing half
 * of A10 is `A7Receipt`'s `failed` state.
 */
import { anyApi } from "convex/server";
import { type ConvexReactClient, useConvex } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { flushAnswerQueue, loadAnswerQueue, type QueuedAnswer } from "../answerQueue";
import { Banner } from "../ui/Banner";

/** True while the Convex connection is up (`connectionState().isWebSocketConnected`). */
export function useOnline(): boolean {
  const client = useConvex();
  const [online, setOnline] = useState(() => client.connectionState().isWebSocketConnected);
  useEffect(() => {
    setOnline(client.connectionState().isWebSocketConnected);
    return client.subscribeToConnectionState((state) => setOnline(state.isWebSocketConnected));
  }, [client]);
  return online;
}

/** The offline banner, with the prototype's words. Nothing while online. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <Banner message="You're offline. Answers wait on this phone and send when you're back." />;
}

/**
 * Sends the answers kept on the phone, at app start and each time the connection returns.
 * `send` records one answer (`answers.record` with this phone's client id). `onSent` fires after
 * each one went through, so a screen can move its receipt on from "Waiting for network".
 * Set `enabled` false until the client id and sign-in are ready.
 */
export function useAnswerQueueFlush(
  send: (item: QueuedAnswer) => Promise<void>,
  options: { enabled?: boolean; onSent?: (item: QueuedAnswer) => void } = {},
): void {
  const online = useOnline();
  const enabled = options.enabled ?? true;
  const sendRef = useRef(send);
  sendRef.current = send;
  const sentRef = useRef(options.onSent);
  sentRef.current = options.onSent;
  // Read the stored queue once at start, so `isQueuedLocally` is right even before a connection.
  useEffect(() => {
    void loadAnswerQueue().catch(() => {});
  }, []);
  useEffect(() => {
    if (!enabled || !online) return;
    void flushAnswerQueue((item) => sendRef.current(item), { onSent: (item) => sentRef.current?.(item) }).catch(() => {
      // A storage error leaves the queue as it was; the next reconnect tries again.
    });
  }, [enabled, online]);
}

/** `answers.record` as `useAnswerQueueFlush` needs it, for a host that has the Convex client at hand. */
export function recordQueuedAnswer(client: ConvexReactClient, clientId: string, item: QueuedAnswer): Promise<unknown> {
  return client.mutation(anyApi.answers.record, {
    questionId: item.questionId,
    clientId,
    optionIds: item.optionIds,
    // When he gave it, so H4 and the bot see the real time; the server ignores a time it can't believe.
    answeredAt: item.queuedAt,
    ...(item.customReply ? { customReply: item.customReply } : {}),
    ...(item.attachments && item.attachments.length > 0 ? { attachments: item.attachments } : {}),
  });
}
