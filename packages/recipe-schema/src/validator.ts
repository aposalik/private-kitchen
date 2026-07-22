import { recipeSchema } from "./schema.js";

export function validateRecipe(input: unknown) {
  return recipeSchema.safeParse(input);
}

export type RecipeValidationResult = ReturnType<typeof validateRecipe>;
export type RecipeJsonValidationResult = RecipeValidationResult | {
  success: false;
  error: SyntaxError;
};

export function validateRecipeJson(input: string): RecipeJsonValidationResult {
  try {
    return validateRecipe(JSON.parse(input) as unknown);
  } catch (error) {
    return {
      success: false,
      error: error instanceof SyntaxError ? error : new SyntaxError("Malformed recipe JSON"),
    };
  }
}
