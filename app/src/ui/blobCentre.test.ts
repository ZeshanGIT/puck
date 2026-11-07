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
  test("puts the ring's centre at 50% of the box plus the shift", () => {
    const g = { size: 100, dx: 3, dy: -2 };
    const box = ringBox(g);
    expect(box.marginLeft + box.width / 2).toBe(3);
    expect(box.marginTop + box.height / 2).toBe(-2);
    expect(box.borderRadius).toBe(50);
  });
});
