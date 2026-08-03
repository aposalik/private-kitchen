import {
  KITCHEN_LAYOUT,
  isPointWithinRadius,
  type PlayerRole,
  type RoundStatus,
} from "@cooking-game/shared";

export interface PresentationPoint {
  readonly left: number;
  readonly top: number;
}

export interface PromptContext {
  readonly role: PlayerRole;
  readonly x: number;
  readonly z: number;
  readonly roundStatus: RoundStatus;
  readonly hasHeldIngredient: boolean;
  readonly completedStepCount: number;
  readonly totalStepCount: number;
}

export interface ContextualPrompt {
  readonly action: "PICK_UP" | "PLACE" | "CHOP" | "COOK" | "SERVE";
  readonly label: string;
  readonly key: "E";
  readonly controllerButton: "A";
}

export function projectWorldToPresentation(
  point: { readonly x: number; readonly z: number },
  width: number,
  height: number,
): PresentationPoint {
  const normalizedX = point.x / KITCHEN_LAYOUT.worldBounds.maxX;
  const normalizedZ = point.z / KITCHEN_LAYOUT.worldBounds.maxZ;
  return {
    left: width * (0.5 + (normalizedX - normalizedZ) * 0.34),
    top: height * (0.15 + (normalizedX + normalizedZ) * 0.38),
  };
}

export function contextualPrompt(
  context: PromptContext,
): ContextualPrompt | undefined {
  if (context.role !== "BLIND_COOK" || context.roundStatus !== "RUNNING") {
    return undefined;
  }
  const point = { x: context.x, z: context.z };
  const stations = KITCHEN_LAYOUT.stations;
  const nearest = Object.entries(stations)
    .filter(([, station]) =>
      isPointWithinRadius(point, station, station.interactionRadius))
    .sort(([, left], [, right]) =>
      distanceSquared(point, left) - distanceSquared(point, right))[0]?.[0];
  if (nearest === "SERVING_PASS") {
    return prompt("SERVE", "Serve dish");
  }
  if (nearest === "STOVE") {
    return prompt("COOK", "Use stove");
  }
  if (nearest === "PREPARATION") {
    return context.hasHeldIngredient
      ? prompt("CHOP", "Prepare ingredient")
      : prompt("PICK_UP", "Pick up ingredient");
  }
  if (nearest === "INGREDIENT_STORAGE") {
    return prompt("PICK_UP", "Pick up ingredient");
  }
  return context.hasHeldIngredient ? prompt("PLACE", "Place ingredient") : prompt("PICK_UP", "Pick up ingredient");
}

function distanceSquared(
  first: { readonly x: number; readonly z: number },
  second: { readonly x: number; readonly z: number },
): number {
  return (first.x - second.x) ** 2 + (first.z - second.z) ** 2;
}

function prompt(
  action: ContextualPrompt["action"],
  label: string,
): ContextualPrompt {
  return { action, label, key: "E", controllerButton: "A" };
}
