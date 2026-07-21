import { describe, expect, test } from "vitest";

import {
  BLIND_COOK_INTERACTION,
  INITIAL_OBJECT_COUNT,
  KITCHEN_BOUNDS,
  createInitialKitchenObjects,
  isWithinReach,
} from "../src/index.js";

describe("deterministic kitchen object placement", () => {
  test("the same seed reproduces IDs, kinds, labels, and positions", () => {
    expect(createInitialKitchenObjects("round-alpha")).toEqual(
      createInitialKitchenObjects("round-alpha"),
    );
  });

  test("different seeds change at least one position without changing the set", () => {
    const first = createInitialKitchenObjects("round-alpha");
    const second = createInitialKitchenObjects("round-beta");

    expect(first).toHaveLength(INITIAL_OBJECT_COUNT);
    expect(second.map(({ id, kind, label }) => ({ id, kind, label }))).toEqual(
      first.map(({ id, kind, label }) => ({ id, kind, label })),
    );
    expect(second.some((object, index) => {
      const other = first[index]!;
      return object.x !== other.x || object.y !== other.y;
    })).toBe(true);
  });

  test("initial positions are finite, in bounds, and reachable", () => {
    for (const object of createInitialKitchenObjects("reachability-check")) {
      expect(Number.isFinite(object.x)).toBe(true);
      expect(Number.isFinite(object.y)).toBe(true);
      expect(object.x).toBeGreaterThanOrEqual(KITCHEN_BOUNDS.minX);
      expect(object.x).toBeLessThanOrEqual(KITCHEN_BOUNDS.maxX);
      expect(object.y).toBeGreaterThanOrEqual(KITCHEN_BOUNDS.minY);
      expect(object.y).toBeLessThanOrEqual(KITCHEN_BOUNDS.maxY);
      expect(isWithinReach(object.x, object.y, BLIND_COOK_INTERACTION)).toBe(true);
    }
  });

  test("known collision seed produces unique coordinates", () => {
    const objects = createInitialKitchenObjects("seed-345");
    const coordinates = objects.map(({ x, y }) => `${x},${y}`);

    expect(new Set(coordinates).size).toBe(objects.length);
  });

  test("placements remain unique, reachable, and stable across seeds", () => {
    for (let index = 0; index < 250; index += 1) {
      const seed = `placement-range-${index}`;
      const first = createInitialKitchenObjects(seed);
      const second = createInitialKitchenObjects(seed);
      const coordinates = first.map(({ x, y }) => `${x},${y}`);

      expect(first).toEqual(second);
      expect(new Set(coordinates).size).toBe(first.length);
      for (const object of first) {
        expect(isWithinReach(object.x, object.y)).toBe(true);
      }
    }
  });
});
