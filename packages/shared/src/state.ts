import type { PlayerRole } from "./roles.js";
import type { KitchenObjectCollection } from "./game-state.js";

export const ROOM_STATUSES = ["WAITING", "READY"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export interface KitchenPlayerState {
  readonly id: string;
  readonly displayName: string;
  readonly role: PlayerRole;
  readonly connected: boolean;
}

export interface KitchenPlayerCollection {
  readonly size: number;
  get(id: string): KitchenPlayerState | undefined;
  values(): IterableIterator<KitchenPlayerState>;
}

export interface KitchenRoomState {
  readonly players: KitchenPlayerCollection;
  readonly objects: KitchenObjectCollection;
  readonly placementSeed: string;
  readonly connectedCount: number;
  readonly status: RoomStatus;
}
