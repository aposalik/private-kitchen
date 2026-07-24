import { KITCHEN_BOUNDS, ROLE_LABELS, type PlayerRole } from "@cooking-game/shared";

import type {
  LobbyObjectSnapshot,
  LobbySnapshot,
} from "../network/RoomClient.js";

export interface ProjectedPoint {
  readonly left: number;
  readonly top: number;
}

export type KitchenStationId =
  | "LECTERN"
  | "PREP"
  | "STOVE"
  | "PASS"
  | "SIGN_BOARD";

export interface ProjectedKitchenStation {
  readonly id: KitchenStationId;
  readonly label: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly hotspot: ProjectedPoint;
  readonly depth: number;
}

export interface ProjectedKitchenAvatar {
  readonly role: PlayerRole;
  readonly label: string;
  readonly stationId: KitchenStationId;
  readonly hotspot: ProjectedPoint;
  readonly depth: number;
}

export type KitchenObjectVisualState =
  | "RAW"
  | "CHOPPED"
  | "RUINED"
  | "IN_POT"
  | "CHOPPED_IN_POT"
  | "RUINED_IN_POT"
  | "HELD_RAW"
  | "HELD_CHOPPED"
  | "HELD_RUINED";

export interface ProjectedKitchenObject {
  readonly id: string;
  readonly kind: LobbyObjectSnapshot["kind"];
  readonly label: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly hotspot: ProjectedPoint;
  readonly depth: number;
  readonly visualState: KitchenObjectVisualState;
  readonly ariaLabel: string;
  readonly heldByMe: boolean;
  readonly held: boolean;
  readonly preparation: LobbyObjectSnapshot["preparation"];
  readonly location: LobbyObjectSnapshot["location"];
  readonly anchorStationId: KitchenStationId | undefined;
}

export interface KitchenObjectAppearance {
  readonly detail: "HIGHLIGHT" | "CHOP_MARKS" | "SMOKE" | "BUBBLES";
  readonly alpha: number;
  readonly scale: number;
}

export interface ProjectedKitchenWorld {
  readonly stations: readonly ProjectedKitchenStation[];
  readonly avatars: readonly ProjectedKitchenAvatar[];
  readonly objects: readonly ProjectedKitchenObject[];
}

const STATION_POSITIONS: ReadonlyArray<
  Omit<ProjectedKitchenStation, "hotspot" | "depth">
> = [
  { id: "LECTERN", label: "Recipe lectern", worldX: 12, worldY: 42 },
  { id: "PREP", label: "Prep counter", worldX: 25, worldY: 30 },
  { id: "STOVE", label: "Copper stove", worldX: 50, worldY: 30 },
  { id: "PASS", label: "Serving pass", worldX: 75, worldY: 30 },
  { id: "SIGN_BOARD", label: "Gesture board", worldX: 88, worldY: 46 },
];

export const KITCHEN_STATIONS: readonly ProjectedKitchenStation[] =
  STATION_POSITIONS.map((station) => ({
    ...station,
    hotspot: projectWorldPoint(station.worldX, station.worldY),
    depth: worldDepth(station.worldX, station.worldY),
  }));

const AVATAR_STATIONS: ReadonlyArray<{
  readonly role: PlayerRole;
  readonly stationId: KitchenStationId;
}> = [
  { role: "RECIPE_KEEPER", stationId: "LECTERN" },
  { role: "BLIND_COOK", stationId: "PREP" },
  { role: "DEAF_KITCHEN_GUIDE", stationId: "SIGN_BOARD" },
];

export function projectWorldPoint(x: number, y: number): ProjectedPoint {
  const normalizedX = normalize(x, KITCHEN_BOUNDS.minX, KITCHEN_BOUNDS.maxX);
  const normalizedY = normalize(y, KITCHEN_BOUNDS.minY, KITCHEN_BOUNDS.maxY);
  return {
    left: roundPercent(50 + (normalizedX - normalizedY) * 32),
    top: roundPercent(13 + (normalizedX + normalizedY) * 37),
  };
}

export function projectKitchenWorld(
  snapshot: LobbySnapshot,
): ProjectedKitchenWorld {
  const projectedObjects = (snapshot.objects ?? [])
    .map(projectObject)
    .sort((left, right) =>
      left.depth - right.depth || left.id.localeCompare(right.id));
  const objects = separateObjectHotspots(projectedObjects);

  return {
    stations: KITCHEN_STATIONS,
    avatars: AVATAR_STATIONS.filter(({ role }) =>
      (snapshot.players ?? (snapshot.role ? [{ role: snapshot.role }] : []))
        .some((player) => player.role === role))
      .map(({ role, stationId }) => {
      const station = KITCHEN_STATIONS.find(({ id }) => id === stationId)!;
      return {
        role,
        label: `${ROLE_LABELS[role]} monkey cook`,
        stationId,
        hotspot: station.hotspot,
        depth: station.depth + 100,
      };
    }),
    objects,
  };
}

function separateObjectHotspots(
  objects: readonly ProjectedKitchenObject[],
): ProjectedKitchenObject[] {
  const placed: ProjectedPoint[] = KITCHEN_STATIONS.map(
    ({ hotspot }) => hotspot,
  );
  const offsets = [
    { left: 0, top: 0 },
    { left: 8, top: 0 },
    { left: -8, top: 0 },
    { left: 5, top: 16 },
    { left: -5, top: 16 },
    { left: 5, top: -16 },
    { left: -5, top: -16 },
    { left: 0, top: 18 },
    { left: 0, top: -18 },
    { left: 12, top: 16 },
    { left: -12, top: 16 },
    { left: 12, top: -16 },
    { left: -12, top: -16 },
    { left: 0, top: 32 },
  ] as const;
  return objects.map((object) => {
    const origin = object.hotspot;
    const hotspot = offsets
      .map((offset) => ({
        left: roundPercent(origin.left + offset.left),
        top: roundPercent(origin.top + offset.top),
      }))
      .find((candidate) => placed.every((other) =>
        Math.abs(candidate.left - other.left) >= 6
        || Math.abs(candidate.top - other.top) >= 15))
      ?? origin;
    placed.push(hotspot);
    return hotspot === origin ? object : { ...object, hotspot };
  });
}

function projectObject(object: LobbyObjectSnapshot): ProjectedKitchenObject {
  const held = object.heldBy !== undefined;
  const anchorStationId = held
    ? "PREP"
    : object.location === "POT"
      ? "STOVE"
      : undefined;
  const anchor = anchorStationId === undefined
    ? undefined
    : KITCHEN_STATIONS.find(({ id }) => id === anchorStationId);
  return {
    id: object.id,
    kind: object.kind,
    label: object.label,
    worldX: object.x,
    worldY: object.y,
    hotspot: anchor?.hotspot ?? projectWorldPoint(object.x, object.y),
    depth: (anchor?.depth ?? worldDepth(object.x, object.y))
      + (held ? 10_000 : 0),
    visualState: objectVisualState(object),
    ariaLabel: objectAriaLabel(object),
    heldByMe: object.heldByMe === true,
    held,
    preparation: object.preparation,
    location: object.location,
    anchorStationId,
  };
}

export function kitchenObjectAppearance(
  visualState: KitchenObjectVisualState,
): KitchenObjectAppearance {
  const held = visualState.startsWith("HELD_");
  const inPot = visualState === "IN_POT" || visualState.endsWith("_IN_POT");
  const ruined = visualState.includes("RUINED");
  const chopped = visualState.includes("CHOPPED");
  return {
    detail: ruined
      ? "SMOKE"
      : inPot
        ? "BUBBLES"
        : chopped
          ? "CHOP_MARKS"
          : "HIGHLIGHT",
    alpha: ruined ? 0.58 : 1,
    scale: held ? 1.14 : 1,
  };
}

function objectVisualState(
  object: LobbyObjectSnapshot,
): KitchenObjectVisualState {
  const preparation = object.preparation;
  if (object.heldBy) return `HELD_${preparation}`;
  if (object.location === "POT") {
    return preparation === "RAW" ? "IN_POT" : `${preparation}_IN_POT`;
  }
  return preparation;
}

function objectAriaLabel(object: LobbyObjectSnapshot): string {
  const holder = object.heldByMe
    ? "held by you"
    : object.heldBy
      ? "held by another player"
      : "available";
  return [
    object.label,
    object.preparation.toLowerCase(),
    object.location === "POT" ? "in pot" : "on counter",
    holder,
  ].join(", ");
}

function worldDepth(x: number, y: number): number {
  const normalizedX = normalize(x, KITCHEN_BOUNDS.minX, KITCHEN_BOUNDS.maxX);
  const normalizedY = normalize(y, KITCHEN_BOUNDS.minY, KITCHEN_BOUNDS.maxY);
  return Math.round((normalizedX + normalizedY) * 1_000);
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function roundPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 1_000) / 1_000;
}
