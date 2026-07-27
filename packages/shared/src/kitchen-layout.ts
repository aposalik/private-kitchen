import type { PlayerRole } from "./roles.js";

export interface KitchenPoint {
  readonly x: number;
  readonly z: number;
}

export interface KitchenBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface KitchenStation extends KitchenPoint {
  readonly interactionRadius: number;
}

export type KitchenStationId =
  | "INGREDIENT_STORAGE"
  | "PREPARATION"
  | "STOVE"
  | "SERVING_PASS"
  | "RECIPE_LECTERN"
  | "GESTURE_STATION";

export interface StaticCollider {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const roleSpawns: Readonly<Record<PlayerRole, KitchenPoint>> = Object.freeze({
  BLIND_COOK: Object.freeze({ x: 50, z: 30 }),
  RECIPE_KEEPER: Object.freeze({ x: 35, z: 12 }),
  DEAF_KITCHEN_GUIDE: Object.freeze({ x: 65, z: 12 }),
});

const stations: Readonly<Record<KitchenStationId, KitchenStation>> = Object.freeze({
  INGREDIENT_STORAGE: Object.freeze({ x: 15, z: 42, interactionRadius: 10 }),
  PREPARATION: Object.freeze({ x: 32, z: 45, interactionRadius: 24 }),
  STOVE: Object.freeze({ x: 50, z: 45, interactionRadius: 24 }),
  SERVING_PASS: Object.freeze({ x: 68, z: 45, interactionRadius: 24 }),
  RECIPE_LECTERN: Object.freeze({ x: 85, z: 42, interactionRadius: 10 }),
  GESTURE_STATION: Object.freeze({ x: 85, z: 18, interactionRadius: 10 }),
});

const staticColliders: readonly StaticCollider[] = Object.freeze([
  Object.freeze({ minX: 8, maxX: 23, minZ: 50, maxZ: 56 }),
  Object.freeze({ minX: 27, maxX: 38, minZ: 50, maxZ: 56 }),
  Object.freeze({ minX: 43, maxX: 57, minZ: 50, maxZ: 56 }),
  Object.freeze({ minX: 62, maxX: 77, minZ: 50, maxZ: 56 }),
]);

export const KITCHEN_LAYOUT = Object.freeze({
  worldBounds: Object.freeze({ minX: 0, maxX: 100, minZ: 0, maxZ: 60 }),
  walkableBounds: Object.freeze({ minX: 2, maxX: 98, minZ: 2, maxZ: 58 }),
  roleSpawns,
  stations,
  staticColliders,
});

export const PLAYER_COLLISION_RADIUS = 2;
export const OBJECT_INTERACTION_RADIUS = 42;
export const HELD_OBJECT_OFFSET = 2.5;

export function isPointWithinRadius(
  first: KitchenPoint,
  second: KitchenPoint,
  radius: number,
): boolean {
  if (![first.x, first.z, second.x, second.z, radius].every(Number.isFinite) || radius < 0) {
    return false;
  }
  const deltaX = first.x - second.x;
  const deltaZ = first.z - second.z;
  return deltaX * deltaX + deltaZ * deltaZ <= radius * radius;
}
