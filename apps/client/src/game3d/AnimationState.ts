export const CHARACTER_ANIMATION_STATES = [
  "IDLE",
  "MOVE",
  "PICK_UP",
  "CARRY",
  "PLACE",
  "CHOP",
  "COOK",
  "SERVE",
  "CELEBRATE",
  "CONFUSED",
] as const;

export type CharacterAnimationState =
  (typeof CHARACTER_ANIMATION_STATES)[number];
