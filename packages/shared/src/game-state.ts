export const KITCHEN_BOUNDS = {
  minX: 0,
  maxX: 100,
  minY: 0,
  maxY: 60,
} as const;

export const BLIND_COOK_INTERACTION = {
  originX: 50,
  originY: 30,
  radius: 42,
} as const;

export const INITIAL_PLACEMENT_BOUNDS = {
  minX: 20,
  maxX: 80,
  minY: 10,
  maxY: 50,
} as const;

export const KITCHEN_OBJECT_DEFINITIONS = [
  { kind: "TOMATO", label: "Tomato" },
  { kind: "ONION", label: "Onion" },
  { kind: "CARROT", label: "Carrot" },
  { kind: "POTATO", label: "Potato" },
] as const;

export type KitchenObjectKind =
  (typeof KITCHEN_OBJECT_DEFINITIONS)[number]["kind"];

export const INITIAL_OBJECT_COUNT = KITCHEN_OBJECT_DEFINITIONS.length;

export interface KitchenObjectState {
  readonly id: string;
  readonly kind: KitchenObjectKind;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly heldBy?: string;
}

export interface KitchenObjectCollection {
  readonly size: number;
  get(id: string): KitchenObjectState | undefined;
  values(): IterableIterator<KitchenObjectState>;
}

export interface InteractionArea {
  readonly originX: number;
  readonly originY: number;
  readonly radius: number;
}

export function isInsideKitchenBounds(x: number, y: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= KITCHEN_BOUNDS.minX &&
    x <= KITCHEN_BOUNDS.maxX &&
    y >= KITCHEN_BOUNDS.minY &&
    y <= KITCHEN_BOUNDS.maxY
  );
}

export function isWithinReach(
  x: number,
  y: number,
  area: InteractionArea = BLIND_COOK_INTERACTION,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  const deltaX = x - area.originX;
  const deltaY = y - area.originY;
  return deltaX * deltaX + deltaY * deltaY <= area.radius * area.radius;
}
