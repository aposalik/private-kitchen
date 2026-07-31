export const MATCHMAKING_ROOM_NAME = "matchmaking";

export const REGIONS = ["EU", "NA", "ASIA", "OTHER"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  EU: "Europe",
  NA: "North America",
  ASIA: "Asia / Pacific",
  OTHER: "Other",
};

export const ROLE_PREFERENCES = [
  "BLIND_COOK",
  "RECIPE_KEEPER",
  "DEAF_KITCHEN_GUIDE",
  "ANY",
] as const;
export type RolePreference = (typeof ROLE_PREFERENCES)[number];

export const ROLE_PREFERENCE_LABELS: Record<RolePreference, string> = {
  BLIND_COOK: "Blind Cook",
  RECIPE_KEEPER: "Recipe Keeper",
  DEAF_KITCHEN_GUIDE: "Deaf Kitchen Guide",
  ANY: "No preference",
};

export const MATCHMAKING_MESSAGES = {
  event: "mm_event",
  readyConfirm: "mm_ready_confirm",
  readyDecline: "mm_ready_decline",
} as const;

export interface MatchmakingJoinOptions {
  displayName: string;
  characterId?: string;
  region: Region;
  rolePreference: RolePreference;
  recipeId?: string;
}

export type MatchmakingServerEvent =
  | { type: "QUEUE_UPDATE"; inQueue: number }
  | { type: "READY_CHECK"; timeoutMs: number; matchId: string; assignedRole: string }
  | { type: "MATCH_READY"; roomId: string; ticket: string }
  | { type: "MATCH_CANCELLED"; reason: "TIMEOUT" | "DECLINED"; requeued: boolean }
  | { type: "PENALTY_ACTIVE"; remainingMs: number };
