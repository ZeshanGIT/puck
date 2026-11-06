import { useSyncExternalStore } from "react";
import { parseRichText } from "./ui/richTextParse";

/**
 * Spoken alarms (A4): with `speak`, the phone reads "<question>. <message>" aloud with Android's
 * own text-to-speech while an urgent alert rings, repeating after a pause until the ring time is
 * up, the alert is answered, or the person silences it. Nothing is generated or stored.
 */

/** The pause between readings. */
export const SPEAK_PAUSE_MS = 4000;

/** Message text without the `**bold**`, `*italic*`, `__underline__` and `` `code` `` markup. */
export function plainText(markup: string): string {
  return parseRichText(markup)
    .map((span) => span.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the phone says: the question as a sentence, then the message. */
export function speechText(question: string, message?: string): string {
  const q = plainText(question);
  const m = message ? plainText(message) : "";
  const sentence = q.length === 0 || /[.!?…]$/.test(q) ? q : `${q}.`;
  return [sentence, m].filter((part) => part.length > 0).join(" ");
}

/* ------------------------------------------------------- "Reading aloud" state */

const reading = new Set<string>();
const listeners = new Set<() => void>();

function setReading(questionId: string, on: boolean): void {
  if (on === reading.has(questionId)) return;
  if (on) reading.add(questionId);
  else reading.delete(questionId);
  listeners.forEach((listener) => listener());
}

/** True only while the phone is really speaking this alert; feeds `AlertFrame`'s `readingAloud`. */
export function useReadingAloud(questionId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => reading.has(questionId),
    () => false,
  );
}

/* ------------------------------------------------------------------ speaking */

/**
 * Starts reading `text` for `ringSeconds`, then stops by itself: a reading that began before the
 * deadline is finished, and no new one starts after it. Returns the function that stops it now.
 */
export function startSpeaking(questionId: string, text: string, ringSeconds: number): () => void {
  if (text.length === 0) return () => {};
  const deadline = Date.now() + ringSeconds * 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let speech: typeof import("expo-speech") | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    setReading(questionId, false);
    void speech?.stop().catch(() => {});
  };

  const pause = () => {
    setReading(questionId, false);
    if (stopped) return;
    if (Date.now() + SPEAK_PAUSE_MS >= deadline) {
      stop();
      return;
    }
    timer = setTimeout(sayIt, SPEAK_PAUSE_MS);
  };

  const sayIt = () => {
    if (stopped || speech === null) return;
    speech.speak(text, {
      onStart: () => {
        if (!stopped) setReading(questionId, true);
      },
      onDone: pause,
      onStopped: () => setReading(questionId, false),
      onError: stop,
    });
  };

  import("expo-speech").then(
    (module) => {
      if (stopped) return;
      speech = module;
      sayIt();
    },
    () => stop(),
  );
  return stop;
}
