import { z } from "zod";

import { KITCHEN_OBJECT_KINDS } from "./game-state.js";

export const KITCHEN_MESSAGES = {
  pickUp: "PICK_UP",
  drop: "DROP",
  interactionError: "INTERACTION_ERROR",
  cookAction: "COOK_ACTION",
  cookingError: "COOKING_ERROR",
  roundReady: "ROUND_READY",
  privateRecipe: "PRIVATE_RECIPE",
} as const;

export const MAX_OBJECT_ID_LENGTH = 64;
export const MAX_ACTION_SEQUENCE = Number.MAX_SAFE_INTEGER;

export const COOK_ACTIONS = [
  "CHOP",
  "ADD_TO_POT",
  "SEASON",
  "BOIL",
  "MIX",
  "PLATE",
] as const;

const invalidRecord = Object.freeze({ invalid: true });
function safeRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return invalidRecord;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidRecord;
  if (["__proto__", "prototype", "constructor"].some((key) => Object.prototype.hasOwnProperty.call(value, key))) return invalidRecord;
  return value;
}

const strictObject = <T extends z.ZodRawShape>(shape: T) =>
  z.preprocess(safeRecord, z.strictObject(shape));
const actionSequenceSchema = z.number().int().min(1).max(MAX_ACTION_SEQUENCE);
const objectIdSchema = z.string().min(1).max(MAX_OBJECT_ID_LENGTH);

export const cookActionSchema = z.union([
  strictObject({
    action: z.enum(["CHOP", "ADD_TO_POT"]),
    actionSequence: actionSequenceSchema,
    objectId: objectIdSchema,
  }),
  strictObject({
    action: z.enum(["SEASON", "BOIL", "MIX", "PLATE"]),
    actionSequence: actionSequenceSchema,
  }),
]);

export type CookAction = z.infer<typeof cookActionSchema>;

export const COOKING_ERROR_CODES = [
  "INVALID_COMMAND",
  "NOT_READY",
  "NOT_RUNNING",
  "NOT_AUTHORIZED",
  "STALE_ACTION",
  "REPLAYED_ACTION",
  "OBJECT_NOT_FOUND",
  "OBJECT_NOT_OWNED",
  "INVALID_PREPARATION",
  "OUT_OF_ORDER",
  "ROUND_TERMINAL",
] as const;

export const MAX_COOKING_ERROR_MESSAGE_LENGTH = 160;
export const cookingErrorSchema = strictObject({
  code: z.enum(COOKING_ERROR_CODES),
  message: z.string().min(1).max(MAX_COOKING_ERROR_MESSAGE_LENGTH),
});
export const roundReadySchema = strictObject({});

export type CookingErrorCode = (typeof COOKING_ERROR_CODES)[number];
export type CookingErrorPayload = z.infer<typeof cookingErrorSchema>;

export const PRIVATE_RECIPE_IDS = ["tomato-soup"] as const;
export const MAX_PRIVATE_RECIPE_TITLE_LENGTH = 80;
export const MAX_PRIVATE_INGREDIENT_COUNT = 16;
export const MAX_PRIVATE_RECIPE_INGREDIENTS = 16;
export const MAX_PRIVATE_RECIPE_STEPS = 64;

const privateRecipeIngredientSchema = strictObject({
  kind: z.enum(KITCHEN_OBJECT_KINDS),
  count: z.number().int().min(1).max(MAX_PRIVATE_INGREDIENT_COUNT),
});
const privateRecipeStepSchema = z.union([
  strictObject({
    action: z.enum(["CHOP", "ADD_TO_POT"]),
    ingredientKind: z.enum(KITCHEN_OBJECT_KINDS),
  }),
  strictObject({ action: z.enum(["SEASON", "BOIL", "MIX", "PLATE"]) }),
]);

export const privateRecipeSchema = strictObject({
  id: z.literal(PRIVATE_RECIPE_IDS[0]),
  title: z.literal("Tomato Soup"),
  ingredients: z.array(privateRecipeIngredientSchema).min(1).max(MAX_PRIVATE_RECIPE_INGREDIENTS),
  steps: z.array(privateRecipeStepSchema).min(1).max(MAX_PRIVATE_RECIPE_STEPS),
});

export type PrivateRecipePayload = z.infer<typeof privateRecipeSchema>;

export function parsePrivateRecipe(input: unknown): PrivateRecipePayload {
  return privateRecipeSchema.parse(input);
}

export interface PickUpPayload {
  objectId: string;
}

export interface DropPayload {
  objectId: string;
  x: number;
  y: number;
}

export const INTERACTION_ERROR_CODES = [
  "INVALID_COMMAND",
  "NOT_READY",
  "NOT_AUTHORIZED",
  "OBJECT_NOT_FOUND",
  "OBJECT_UNAVAILABLE",
  "ALREADY_HOLDING",
  "OUT_OF_REACH",
  "NOT_HOLDER",
  "INVALID_DESTINATION",
] as const;

export type InteractionErrorCode = (typeof INTERACTION_ERROR_CODES)[number];

export interface InteractionErrorPayload {
  code: InteractionErrorCode;
  message: string;
}
