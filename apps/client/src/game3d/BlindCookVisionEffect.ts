import type { PlayerRole } from "@cooking-game/shared";

export const BLIND_COOK_VISION_RESTRICTION_ENABLED = false as const;

export interface BlindCookVisionEffect {
  readonly enabled: boolean;
  readonly role: PlayerRole | undefined;
  apply(): void;
  destroy(): void;
}

export function createBlindCookVisionEffect(
  role: PlayerRole | undefined,
): BlindCookVisionEffect {
  return {
    enabled: BLIND_COOK_VISION_RESTRICTION_ENABLED && role === "BLIND_COOK",
    role,
    apply: () => undefined,
    destroy: () => undefined,
  };
}
