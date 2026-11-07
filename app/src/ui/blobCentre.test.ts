import { describe, expect, test } from "bun:test";
import { bodyCentre, RING_SIZE, ringBox, ringGeometry, samplePath } from "./blobCentre";
import { SAMPLE_BOTS, SHAPES, type ShapeName } from "./blobShapes";

describe("samplePath", () => {
  test("reads M, H, V, L and Z", () => {
    const points = samplePath("M10 20H30V40L10 40Z");
    expect(points[0]).toEqual({ x: 10, y: 20 });
    expect(points[1]).toEqual({ x: 30, y: 20 });
    expect(points[2]).toEqual({ x: 30, y: 40 });
    expect(points[points.length - 1]).toEqual({ x: 10, y: 20 });
  });

  test("a curve ends at its last control point", () => {
    const points = samplePath("M0 0C0 10 10 10 10 0");
    expect(points[points.length - 1]!.x).toBeCloseTo(10, 6);
    expect(points[points.length - 1]!.y).toBeCloseTo(0, 6);
  });
});

describe("bodyCentre", () => {
  test("a round body with no tilt sits on the box centre", () => {
    const c = bodyCentre("round", 0);
    expect(Math.abs(c.x - 50)).toBeLessThan(0.6);
    expect(Math.abs(c.y - 50)).toBeLessThan(0.6);
  });

  test("the cloud's extent is centred well below the middle of its box (the cause of the off-centre ring)", () => {
    expect(bodyCentre("cloud", 0).y - 50).toBeGreaterThan(2.5);
  });

  test("every shape's centre is inside the body's extent in the box, and tilt moves it only a little", () => {
    for (const shape of Object.keys(SHAPES) as ShapeName[]) {
      for (const tilt of [-7, 0, 6]) {
        const c = bodyCentre(shape, tilt);
        expect(c.x).toBeGreaterThan(40);
        expect(c.x).toBeLessThan(60);
        expect(c.y).toBeGreaterThan(40);
        expect(c.y).toBeLessThan(60);
      }
    }
  });
});

describe("ringGeometry", () => {
  test("keeps the prototype's ring size whatever the blob size", () => {
    expect(ringGeometry(SAMPLE_BOTS.sheldon, 156).size).toBe(RING_SIZE);
    expect(ringGeometry(SAMPLE_BOTS.sheldon, 84).size).toBe(RING_SIZE);
  });

  test("the shift is the body-centre offset in dp, so it scales with the blob", () => {
    const big = ringGeometry(SAMPLE_BOTS.cortana, 156);
    const small = ringGeometry(SAMPLE_BOTS.cortana, 78);
    expect(small.dx).toBeCloseTo(big.dx / 2, 6);
    expect(small.dy).toBeCloseTo(big.dy / 2, 6);
  });

  test("the ring's centre, plus the shift, lands on the body's centre for every sample bot", () => {
    for (const bot of Object.values(SAMPLE_BOTS)) {
      const size = 156;
      const g = ringGeometry(bot, size);
      const c = bodyCentre(bot.shape, bot.tilt);
      expect(size / 2 + g.dx).toBeCloseTo((c.x / 100) * size, 6);
      expect(size / 2 + g.dy).toBeCloseTo((c.y / 100) * size, 6);
    }
  });
});

describe("ringBox", () => {
  test("the ring's centre lands on the box centre plus the shift, in pixels from the box's corner", () => {
    const g = { size: 150, box: 156, dx: 3, dy: -2 };
    const b = ringBox(g);
    expect(b.left + b.width / 2).toBe(156 / 2 + 3);
    expect(b.top + b.height / 2).toBe(156 / 2 - 2);
    expect(b.borderRadius).toBe(75);
  });

  test("a round body at any blob size has its ring's centre on the blob's centre, with no percentage involved", () => {
    for (const size of [84, 112, 128, 156]) {
      const g = ringGeometry(SAMPLE_BOTS.puck, size);
      const b = ringBox(g);
      expect(Math.abs(b.left + b.width / 2 - size / 2)).toBeLessThan(0.02 * size);
      expect(Math.abs(b.top + b.height / 2 - size / 2)).toBeLessThan(0.02 * size);
    }
  });

  test("on a 360 dp screen the ring stays within the body's own box: its centre is never 120 dp from the blob", () => {
    for (const bot of Object.values(SAMPLE_BOTS)) {
      const g = ringGeometry(bot, 128);
      expect(Math.abs(g.dx)).toBeLessThan(10);
      expect(Math.abs(g.dy)).toBeLessThan(10);
    }
  });
});
