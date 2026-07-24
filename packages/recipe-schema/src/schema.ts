import { z } from "zod";

export const RECIPE_SCHEMA_VERSION = 1 as const;
export const INGREDIENT_KINDS = ["TOMATO", "ONION", "CARROT", "POTATO"] as const;
export const RECIPE_ACTIONS = ["CHOP", "ADD_TO_POT", "SEASON", "BOIL", "MIX", "PLATE"] as const;
export const DEFAULT_ROUND_DURATION_MS = 300_000;
export const MAX_RECIPE_DURATION_MS = 3_600_000;
export const MAX_INGREDIENT_COUNT = 16;
export const MAX_RECIPE_ID_LENGTH = 64;
export const MAX_RECIPE_TITLE_LENGTH = 80;
export const MAX_RECIPE_INGREDIENTS = 16;
export const MAX_RECIPE_STEPS = 64;
export const MAX_STEP_DEPENDENCIES = 16;
export const MAX_TOTAL_INGREDIENT_OBJECTS = 16;

export const recipeIdSchema = z.string()
  .min(1)
  .max(MAX_RECIPE_ID_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const boundedIdSchema = recipeIdSchema;

export const recipeIngredientSchema = z.strictObject({
  id: boundedIdSchema,
  kind: z.enum(INGREDIENT_KINDS),
  count: z.number().int().min(1).max(MAX_INGREDIENT_COUNT),
});

export const recipeStepSchema = z.strictObject({
  id: boundedIdSchema,
  action: z.enum(RECIPE_ACTIONS),
  ingredientId: boundedIdSchema.optional(),
  dependsOn: z.array(boundedIdSchema).max(MAX_STEP_DEPENDENCIES),
});

export const recipeSchema = z.strictObject({
  schemaVersion: z.literal(RECIPE_SCHEMA_VERSION),
  id: recipeIdSchema,
  title: z.string().min(1).max(MAX_RECIPE_TITLE_LENGTH),
  roundDurationMs: z.number().int().min(1).max(MAX_RECIPE_DURATION_MS),
  ingredients: z.array(recipeIngredientSchema).min(1).max(MAX_RECIPE_INGREDIENTS),
  steps: z.array(recipeStepSchema).min(1).max(MAX_RECIPE_STEPS),
}).superRefine((recipe, context) => {
  const totalObjects = recipe.ingredients.reduce((total, ingredient) => total + ingredient.count, 0);
  if (totalObjects > MAX_TOTAL_INGREDIENT_OBJECTS) {
    context.addIssue({
      code: "custom",
      message: `Recipe requires too many physical objects (maximum ${MAX_TOTAL_INGREDIENT_OBJECTS})`,
      path: ["ingredients"],
    });
  }
  addDuplicateIdIssues(recipe.ingredients, "ingredients", context);
  addDuplicateIdIssues(recipe.steps, "steps", context);
  const ingredientKinds = new Set<string>();
  recipe.ingredients.forEach((ingredient, index) => {
    if (ingredientKinds.has(ingredient.kind)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ingredient kind: ${ingredient.kind}`,
        path: ["ingredients", index, "kind"],
      });
    }
    ingredientKinds.add(ingredient.kind);
  });

  const ingredientIds = new Set(recipe.ingredients.map(({ id }) => id));
  const stepIds = new Set(recipe.steps.map(({ id }) => id));
  const priorStepIds = new Set<string>();
  recipe.steps.forEach((step, index) => {
    const usesIngredient = step.action === "CHOP" || step.action === "ADD_TO_POT";
    if (usesIngredient && (step.ingredientId === undefined || !ingredientIds.has(step.ingredientId))) {
      context.addIssue({
        code: "custom",
        message: `Invalid ingredient reference for ${step.action}`,
        path: ["steps", index, "ingredientId"],
      });
    }
    if (!usesIngredient && step.ingredientId !== undefined) {
      context.addIssue({
        code: "custom",
        message: `${step.action} must not reference an ingredient`,
        path: ["steps", index, "ingredientId"],
      });
    }
    step.dependsOn.forEach((dependency, dependencyIndex) => {
      if (!stepIds.has(dependency)) {
        context.addIssue({
          code: "custom",
          message: `Unknown step dependency: ${dependency}`,
          path: ["steps", index, "dependsOn", dependencyIndex],
        });
      }
      if (!priorStepIds.has(dependency)) {
        context.addIssue({
          code: "custom",
          message: `Dependency must reference an earlier step: ${dependency}`,
          path: ["steps", index, "dependsOn", dependencyIndex],
        });
      }
    });
    priorStepIds.add(step.id);
  });

  validateOrderedActions(recipe, context);
});

function validateOrderedActions(
  recipe: {
    ingredients: readonly { id: string }[];
    steps: readonly z.infer<typeof recipeStepSchema>[];
  },
  context: z.RefinementCtx,
): void {
  const ingredientCount = recipe.ingredients.length;
  const chopSteps = recipe.steps.slice(0, ingredientCount);
  const addSteps = recipe.steps.slice(ingredientCount, ingredientCount * 2);
  const terminalSteps = recipe.steps.slice(ingredientCount * 2);
  const ingredientIds = recipe.ingredients.map(({ id }) => id);
  const terminalActions = ["SEASON", "BOIL", "MIX", "PLATE"] as const;

  const phasesAreExact =
    recipe.steps.length === ingredientCount * 2 + terminalActions.length
    && chopSteps.every(({ action }) => action === "CHOP")
    && addSteps.every(({ action }) => action === "ADD_TO_POT")
    && terminalSteps.every((step, index) => step.action === terminalActions[index]);
  if (!phasesAreExact) {
    context.addIssue({
      code: "custom",
      message: "Actions must be all CHOP, all ADD_TO_POT, then exactly SEASON, BOIL, MIX, PLATE",
      path: ["steps"],
    });
    return;
  }

  if (!sameUniqueMembers(chopSteps.map(({ ingredientId }) => ingredientId), ingredientIds)) {
    context.addIssue({ code: "custom", message: "Each ingredient requires exactly one CHOP step", path: ["steps"] });
  }
  if (!sameUniqueMembers(addSteps.map(({ ingredientId }) => ingredientId), ingredientIds)) {
    context.addIssue({ code: "custom", message: "Each ingredient requires exactly one ADD_TO_POT step", path: ["steps"] });
  }

  const chopIdByIngredient = new Map(chopSteps.map((step) => [step.ingredientId, step.id]));
  chopSteps.forEach((step, index) => {
    if (step.dependsOn.length !== 0) {
      context.addIssue({ code: "custom", message: "CHOP steps cannot have dependencies", path: ["steps", index, "dependsOn"] });
    }
  });
  addSteps.forEach((step, index) => {
    const requiredChopId = chopIdByIngredient.get(step.ingredientId);
    if (requiredChopId === undefined || !sameUniqueMembers(step.dependsOn, [requiredChopId])) {
      context.addIssue({
        code: "custom",
        message: "ADD_TO_POT must depend on its matching CHOP step",
        path: ["steps", ingredientCount + index, "dependsOn"],
      });
    }
  });

  const seasonIndex = ingredientCount * 2;
  const seasonStep = terminalSteps[0]!;
  if (!sameUniqueMembers(seasonStep.dependsOn, addSteps.map(({ id }) => id))) {
    context.addIssue({ code: "custom", message: "SEASON must depend on every ADD_TO_POT step", path: ["steps", seasonIndex, "dependsOn"] });
  }
  terminalSteps.slice(1).forEach((step, index) => {
    const previousStep = terminalSteps[index]!;
    if (!sameUniqueMembers(step.dependsOn, [previousStep.id])) {
      context.addIssue({
        code: "custom",
        message: `${step.action} must depend on ${previousStep.action}`,
        path: ["steps", seasonIndex + index + 1, "dependsOn"],
      });
    }
  });
}

function sameUniqueMembers(values: readonly (string | undefined)[], expected: readonly string[]): boolean {
  return values.length === expected.length
    && new Set(values).size === values.length
    && values.every((value) => value !== undefined && expected.includes(value));
}

function addDuplicateIdIssues(
  values: readonly { id: string }[],
  collection: "ingredients" | "steps",
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate ${collection} ID: ${value.id}`,
        path: [collection, index, "id"],
      });
    }
    seen.add(value.id);
  });
}

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
