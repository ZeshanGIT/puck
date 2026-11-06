/**
 * How a real bot looks on screen: its blob colour, shape and tilt. Plain TypeScript, no React.
 *
 * Bots do not carry a colour yet (a later card), so until they do the look is derived
 * from the bot: an explicit `colour` or `shape` wins, then the prototype's sample bot with
 * the same name (Sheldon, Brow, Grok Bot, Deploy Watch, Puck, Cortana), then a hash of the
 * public `botId`, so the same bot always looks the same.
 */
import { PALETTE, type PaletteName } from "./botTheme";
import { SAMPLE_BOTS, SHAPES, type BlobBot, type ShapeName } from "./blobShapes";

export interface BotLookInput {
  botId: string;
  botName: string;
  colour?: PaletteName;
  shape?: ShapeName;
}

const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

/** The sample tilts run from -7 to 6 degrees; derived tilts use the same range. */
const TILT_MIN = -7;
const TILT_SPAN = 14;

/** FNV-1a, 32 bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The sample bot whose key or name equals `name`, ignoring case and surrounding spaces. */
function sampleFor(name: string): BlobBot | null {
  const wanted = name.trim().toLowerCase();
  for (const [key, sample] of Object.entries(SAMPLE_BOTS)) {
    if (key === wanted || sample.name.toLowerCase() === wanted) return sample;
  }
  return null;
}

export function botLook(bot: BotLookInput): BlobBot {
  const sample = sampleFor(bot.botName);
  const h = hash(bot.botId);
  const colour = bot.colour ?? sample?.colour ?? PALETTE[h % PALETTE.length]!.name;
  const shape = bot.shape ?? sample?.shape ?? SHAPE_NAMES[Math.floor(h / PALETTE.length) % SHAPE_NAMES.length]!;
  const tilt =
    sample?.tilt ?? TILT_MIN + (Math.floor(h / (PALETTE.length * SHAPE_NAMES.length)) % TILT_SPAN);
  return { name: bot.botName, colour, shape, tilt };
}
