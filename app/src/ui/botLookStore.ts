/**
 * The colour and shape each paired bot chose (`puck add --colour --shape`, or its page in Puck), so
 * every screen draws a bot the same way: the bot list, Home, the alert, the stack and the card over
 * other apps. Alerts and pushes carry only the bot's id and name, so the looks come from `bots.list`
 * (remembered here whenever the signed-in app loads it) and are kept on the phone for a headless
 * start, when the card shows with Puck closed.
 *
 * Plain TypeScript; storage is loaded lazily, so the rules can be unit-tested.
 */
import { isPaletteName, type PaletteName } from "./botTheme";
import { SHAPES, type ShapeName } from "./blobShapes";

export interface StoredLook {
  colour?: PaletteName;
  shape?: ShapeName;
}

const STORE_KEY = "puck.botLooks";

let looks = new Map<string, StoredLook>();
let version = 0;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function isShapeName(value: string): value is ShapeName {
  return Object.hasOwn(SHAPES, value);
}

/** One bot's look from `bots.list`, keeping only the names this build knows. */
export function storedLook(bot: { colour?: string | null; shape?: string | null }): StoredLook {
  const look: StoredLook = {};
  if (typeof bot.colour === "string" && isPaletteName(bot.colour)) look.colour = bot.colour;
  if (typeof bot.shape === "string" && isShapeName(bot.shape)) look.shape = bot.shape;
  return look;
}

/** The look a bot chose, or undefined when Puck has not seen it in the bot list. */
export function knownLook(botId: string): StoredLook | undefined {
  return looks.get(botId);
}

/** Changes each time the remembered looks change, for `useSyncExternalStore`. */
export function botLooksVersion(): number {
  return version;
}

export function subscribeBotLooks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function encode(map: Map<string, StoredLook>): string {
  return JSON.stringify([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Parses what `rememberBotLooks` stored; anything unreadable is an empty set. */
export function parseBotLooks(raw: string | null): Map<string, StoredLook> {
  const map = new Map<string, StoredLook>();
  if (!raw) return map;
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return map;
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "object" || entry[1] === null) continue;
      map.set(entry[0], storedLook(entry[1] as { colour?: string; shape?: string }));
    }
  } catch {
    return new Map();
  }
  return map;
}

function replace(next: Map<string, StoredLook>): boolean {
  if (encode(next) === encode(looks)) return false;
  looks = next;
  version += 1;
  for (const listener of listeners) listener();
  return true;
}

/**
 * The bot list as the backend returns it: the looks it holds replace the remembered ones (a bot
 * removed from the list is forgotten), and are saved on the phone when they changed.
 */
export function rememberBotLooks(bots: readonly { botId: string; colour?: string | null; shape?: string | null }[]): void {
  const next = new Map(bots.map((bot) => [bot.botId, storedLook(bot)] as const));
  if (!replace(next)) return;
  const text = encode(next);
  void import("expo-secure-store")
    .then((SecureStore) => SecureStore.setItemAsync(STORE_KEY, text))
    .catch(() => undefined);
}

/** Reads the saved looks once (a headless start awaits this before drawing the card). Never throws. */
export function loadBotLooks(): Promise<void> {
  loading ??= import("expo-secure-store")
    .then((SecureStore) => SecureStore.getItemAsync(STORE_KEY))
    .then((raw) => {
      // The live bot list may have arrived first; it wins.
      if (looks.size === 0) replace(parseBotLooks(raw));
    })
    .catch(() => undefined);
  return loading;
}

/** Tests only: forget everything. */
export function resetBotLooksForTest(): void {
  looks = new Map();
  version = 0;
  loading = null;
}
