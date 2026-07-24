import { recipeSchema } from "./schema.js";

export function validateRecipe(input: unknown) {
  return recipeSchema.safeParse(input);
}

export interface RecipeDiagnostic {
  code: string;
  path: string;
  message: string;
}

export interface RecipeDiagnostics {
  valid: boolean;
  issues: RecipeDiagnostic[];
}

export function diagnoseRecipe(input: unknown): RecipeDiagnostics {
  const result = validateRecipe(input);
  if (result.success) return { valid: true, issues: [] };
  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      code: issue.code === "custom" && issue.message.startsWith("Recipe requires too many physical objects")
        ? "too_many_objects"
        : issue.code,
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
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
