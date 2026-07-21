export const PLAYER_ROLES = [
  "BLIND_COOK",
  "RECIPE_KEEPER",
  "DEAF_KITCHEN_GUIDE",
] as const;

export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const ROLE_LABELS: Readonly<Record<PlayerRole, string>> = {
  BLIND_COOK: "Blind Cook",
  RECIPE_KEEPER: "Recipe Keeper",
  DEAF_KITCHEN_GUIDE: "Deaf Kitchen Guide",
};
