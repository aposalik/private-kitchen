import { describe, expect, test } from "vitest";

import {
  KITCHEN_LAYOUT,
  PLAYER_ROLES,
  movementIntentSchema,
  playerTransformSchema,
} from "../src/index.js";

describe("shared movement contract", () => {
  test("defines immutable deterministic spawns and strict finite normalized movement", () => {
    expect(Object.keys(KITCHEN_LAYOUT.roleSpawns)).toEqual([...PLAYER_ROLES]);
    expect(new Set(
      PLAYER_ROLES.map((role) => JSON.stringify(KITCHEN_LAYOUT.roleSpawns[role])),
    ).size).toBe(PLAYER_ROLES.length);
    expect(Object.isFrozen(KITCHEN_LAYOUT)).toBe(true);
    expect(Object.isFrozen(KITCHEN_LAYOUT.roleSpawns)).toBe(true);

    expect(movementIntentSchema.parse({ sequence: 1, axisX: 0.6, axisZ: -0.8 }))
      .toEqual({ sequence: 1, axisX: 0.6, axisZ: -0.8 });
    for (const invalid of [
      { sequence: 1, axisX: Number.NaN, axisZ: 0 },
      { sequence: 1, axisX: Number.POSITIVE_INFINITY, axisZ: 0 },
      { sequence: 1, axisX: 1, axisZ: 1 },
      { sequence: 0, axisX: 0, axisZ: 0 },
      { sequence: 1, axisX: 0, axisZ: 0, x: 50 },
      Object.assign(Object.create({ axisX: 0 }), { sequence: 1, axisZ: 0 }),
    ]) {
      expect(movementIntentSchema.safeParse(invalid).success).toBe(false);
    }

    expect(playerTransformSchema.parse({
      x: 50,
      z: 30,
      facingYaw: 0,
      locomotion: "IDLE",
      lastProcessedMovementSequence: 0,
    })).toMatchObject({ x: 50, z: 30, locomotion: "IDLE" });
  });
});
