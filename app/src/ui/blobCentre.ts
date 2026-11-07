/**
 * Where a blob's body really is inside its square box, and the urgent pulse rings that follow it.
 *
 * The body paths are drawn in a 100 x 100 box, then rotated by the bot's tilt about (50, 50). Most
 * shapes sit close to (50, 50), but not all of them: the cloud's extent is centred about 3 units
 * below the box centre, and the tilt swings the offset around. Rings drawn at the box centre
 * therefore looked a few dp off the blob for some bots. The extent of the sampled path (after the
 * tilt) gives the centre the rings should use. Plain TypeScript, no React.
 */
import { type BlobBot, SHAPES, type ShapeName } from "./blobShapes";

export interface Point {
  x: number;
  y: number;
}

const CURVE_STEPS = 24;

/** Points along an SVG path made of absolute M, L, H, V, C, Q and Z commands (what `SHAPES` uses). */
export function samplePath(d: string): Point[] {
  const tokens = d.match(/[MLHVCQZ]|-?\d*\.?\d+/gu) ?? [];
  const points: Point[] = [];
  let i = 0;
  let command = "";
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  const push = (p: Point) => {
    points.push(p);
    cur = p;
  };
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (/[A-Z]/u.test(token)) {
      command = token;
      i += 1;
      if (command === "Z") {
        push(start);
        continue;
      }
    }
    // Numbers without a new letter repeat the command (an implicit lineto after M, more curves after C).
    if (command === "M") {
      const p = { x: num(), y: num() };
      start = p;
      push(p);
      command = "L";
    } else if (command === "L") {
      push({ x: num(), y: num() });
    } else if (command === "H") {
      push({ x: num(), y: cur.y });
    } else if (command === "V") {
      push({ x: cur.x, y: num() });
    } else if (command === "C") {
      const p0 = cur;
      const p1 = { x: num(), y: num() };
      const p2 = { x: num(), y: num() };
      const p3 = { x: num(), y: num() };
      for (let s = 1; s <= CURVE_STEPS; s += 1) {
        const t = s / CURVE_STEPS;
        const u = 1 - t;
        points.push({
          x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
      cur = p3;
    } else if (command === "Q") {
      const p0 = cur;
      const p1 = { x: num(), y: num() };
      const p2 = { x: num(), y: num() };
      for (let s = 1; s <= CURVE_STEPS; s += 1) {
        const t = s / CURVE_STEPS;
        const u = 1 - t;
        points.push({
          x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
          y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
        });
      }
      cur = p2;
    } else {
      i += 1;
    }
  }
  return points;
}

/** The centre of the body's extent, in the 100 x 100 box, after rotating by `tilt` degrees about (50, 50). */
export function bodyCentre(shape: ShapeName, tilt: number): Point {
  const rad = (tilt * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of samplePath(SHAPES[shape])) {
    const dx = p.x - 50;
    const dy = p.y - 50;
    const x = 50 + dx * cos - dy * sin;
    const y = 50 + dx * sin + dy * cos;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** The prototype's `.ring` diameter at rest, in dp; the pulse scales it from 0.9 to 1.65. */
export const RING_SIZE = 150;

export interface RingGeometry {
  /** Ring diameter at rest, in dp. */
  size: number;
  /** Shift from the middle of the blob's box to the middle of its body, in dp. */
  dx: number;
  dy: number;
}

/** The ring for a blob of `blobSize` dp, centred on the body rather than the box (the size is the prototype's). */
export function ringGeometry(bot: Pick<BlobBot, "shape" | "tilt">, blobSize: number): RingGeometry {
  const c = bodyCentre(bot.shape, bot.tilt);
  const unit = blobSize / 100;
  return { size: RING_SIZE, dx: (c.x - 50) * unit, dy: (c.y - 50) * unit };
}

/** The ring's absolute box style: `left` and `top` are 50% of the blob's box; this centres it on the body. */
export function ringBox(g: RingGeometry): {
  width: number;
  height: number;
  marginLeft: number;
  marginTop: number;
  borderRadius: number;
} {
  return {
    width: g.size,
    height: g.size,
    marginLeft: -g.size / 2 + g.dx,
    marginTop: -g.size / 2 + g.dy,
    borderRadius: g.size / 2,
  };
}
