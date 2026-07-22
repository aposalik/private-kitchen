import {
  INITIAL_PLACEMENT_BOUNDS,
  KITCHEN_OBJECT_DEFINITIONS,
  type KitchenObjectState,
} from "./game-state.js";

export function createInitialKitchenObjects(
  seed: string,
): readonly KitchenObjectState[] {
  const next = seededGenerator(seed);
  const coordinates = placementCoordinates();
  shuffle(coordinates, next);
  if (coordinates.length < KITCHEN_OBJECT_DEFINITIONS.length) {
    throw new Error("Not enough coordinates for initial kitchen objects");
  }

  return KITCHEN_OBJECT_DEFINITIONS.map((definition, index) => ({
    id: `ingredient-${index + 1}`,
    kind: definition.kind,
    label: definition.label,
    x: coordinates[index]!.x,
    y: coordinates[index]!.y,
    preparation: "RAW",
    location: "COUNTER",
  }));
}

interface Coordinate {
  x: number;
  y: number;
}

function placementCoordinates(): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (
    let x = INITIAL_PLACEMENT_BOUNDS.minX;
    x <= INITIAL_PLACEMENT_BOUNDS.maxX;
    x += 1
  ) {
    for (
      let y = INITIAL_PLACEMENT_BOUNDS.minY;
      y <= INITIAL_PLACEMENT_BOUNDS.maxY;
      y += 1
    ) {
      coordinates.push({ x, y });
    }
  }
  return coordinates;
}

function shuffle<T>(values: T[], next: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    const value = values[index]!;
    values[index] = values[swapIndex]!;
    values[swapIndex] = value;
  }
}

function seededGenerator(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
