import { z } from "zod";

import type { PlayerRole } from "./roles.js";
import type { KitchenObjectCollection } from "./game-state.js";

export const ROOM_STATUSES = ["WAITING", "READY"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const ROUND_STATUSES = ["NOT_STARTED", "RUNNING", "PAUSED", "WON", "LOST"] as const;
export const ROUND_OUTCOME_REASONS = ["NONE", "COMPLETED", "TIME_EXPIRED"] as const;
export const MAX_ROUND_REMAINING_MS = 3_600_000;
export const MAX_PUBLIC_STEP_COUNT = 64;

export type RoundStatus = (typeof ROUND_STATUSES)[number];
export type RoundOutcomeReason = (typeof ROUND_OUTCOME_REASONS)[number];

export const publicRoundStateSchema = z.strictObject({
  roundStatus: z.enum(ROUND_STATUSES),
  remainingMs: z.number().int().min(0).max(MAX_ROUND_REMAINING_MS),
  completedStepCount: z.number().int().min(0).max(MAX_PUBLIC_STEP_COUNT),
  totalStepCount: z.number().int().min(0).max(MAX_PUBLIC_STEP_COUNT),
  outcomeReason: z.enum(ROUND_OUTCOME_REASONS),
}).superRefine((state, context) => {
  if (state.completedStepCount > state.totalStepCount) {
    context.addIssue({
      code: "custom",
      message: "Completed step count cannot exceed total step count",
      path: ["completedStepCount"],
    });
  }
});

export type PublicRoundState = z.infer<typeof publicRoundStateSchema>;

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
  readonly roundStatus: RoundStatus;
  readonly remainingMs: number;
  readonly completedStepCount: number;
  readonly totalStepCount: number;
  readonly outcomeReason: RoundOutcomeReason;
}
