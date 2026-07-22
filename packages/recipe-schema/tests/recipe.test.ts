import { describe, expect, test } from "vitest";

import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_INGREDIENT_COUNT,
  MAX_RECIPE_DURATION_MS,
  MAX_RECIPE_ID_LENGTH,
  TOMATO_SOUP_RECIPE,
  validateRecipe,
  validateRecipeJson,
} from "../src/index.js";

const validRecipe = {
  schemaVersion: 1,
  id: "tomato-soup",
  title: "Tomato Soup",
  roundDurationMs: 300_000,
  ingredients: [
    { id: "tomato", kind: "TOMATO", count: 2 },
    { id: "onion", kind: "ONION", count: 1 },
  ],
  steps: [
    { id: "chop-tomato", action: "CHOP", ingredientId: "tomato", dependsOn: [] },
    { id: "chop-onion", action: "CHOP", ingredientId: "onion", dependsOn: [] },
    { id: "add-tomato", action: "ADD_TO_POT", ingredientId: "tomato", dependsOn: ["chop-tomato"] },
    { id: "add-onion", action: "ADD_TO_POT", ingredientId: "onion", dependsOn: ["chop-onion"] },
    { id: "season", action: "SEASON", dependsOn: ["add-tomato", "add-onion"] },
    { id: "boil", action: "BOIL", dependsOn: ["season"] },
    { id: "mix", action: "MIX", dependsOn: ["boil"] },
    { id: "plate", action: "PLATE", dependsOn: ["mix"] },
  ],
};

describe("versioned recipe schema", () => {
  test("accepts a valid version 1 recipe", () => {
    expect(validateRecipe(validRecipe).success).toBe(true);
  });

  test("rejects unknown fields recursively", () => {
    expect(validateRecipe({ ...validRecipe, metadata: "untrusted" }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      ingredients: [{ ...validRecipe.ingredients[0], label: "red" }, validRecipe.ingredients[1]],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], instruction: "free text" }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
  });

  test("rejects unsupported recipe IDs, ingredient kinds, actions, and schema versions", () => {
    expect(validateRecipe({ ...validRecipe, schemaVersion: 2 }).success).toBe(false);
    expect(validateRecipe({ ...validRecipe, id: "mystery-stew" }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      ingredients: [{ ...validRecipe.ingredients[0], kind: "MUSHROOM" }, validRecipe.ingredients[1]],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], action: "FRY" }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
  });

  test("rejects nonpositive or out-of-bound counts, duration, IDs, and references", () => {
    for (const count of [0, -1, MAX_INGREDIENT_COUNT + 1]) {
      expect(validateRecipe({
        ...validRecipe,
        ingredients: [{ ...validRecipe.ingredients[0], count }, validRecipe.ingredients[1]],
      }).success).toBe(false);
    }
    for (const roundDurationMs of [0, -1, MAX_RECIPE_DURATION_MS + 1]) {
      expect(validateRecipe({ ...validRecipe, roundDurationMs }).success).toBe(false);
    }
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], id: "x".repeat(MAX_RECIPE_ID_LENGTH + 1) }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], dependsOn: ["x".repeat(MAX_RECIPE_ID_LENGTH + 1)] }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
  });

  test("rejects duplicate ingredient and step IDs", () => {
    expect(validateRecipe({
      ...validRecipe,
      ingredients: [validRecipe.ingredients[0], { ...validRecipe.ingredients[1], id: "tomato" }],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [validRecipe.steps[0], { ...validRecipe.steps[1], id: "chop-tomato" }, ...validRecipe.steps.slice(2)],
    }).success).toBe(false);
  });

  test("rejects impossible ingredient and dependency references", () => {
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], ingredientId: "garlic" }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], dependsOn: ["missing-step"] }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
    const { ingredientId: _ingredientId, ...chopWithoutIngredient } = validRecipe.steps[0];
    expect(validateRecipe({
      ...validRecipe,
      steps: [chopWithoutIngredient, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: validRecipe.steps.map((step) => step.id === "season" ? { ...step, ingredientId: "tomato" } : step),
    }).success).toBe(false);
  });

  test("rejects invalid dependency graphs and action order", () => {
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], dependsOn: ["chop-tomato"] }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], dependsOn: ["add-tomato"] }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [validRecipe.steps[2], validRecipe.steps[1], validRecipe.steps[0], ...validRecipe.steps.slice(3)],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [{ ...validRecipe.steps[0], ingredientId: "onion" }, ...validRecipe.steps.slice(1)],
    }).success).toBe(false);
    expect(validateRecipe({
      ...validRecipe,
      steps: [
        ...validRecipe.steps.slice(0, 6),
        { ...validRecipe.steps[6], action: "PLATE" },
        { ...validRecipe.steps[7], action: "MIX" },
      ],
    }).success).toBe(false);
  });

  test("returns a validation failure for malformed recipe JSON", () => {
    const result = validateRecipeJson('{"schemaVersion":1');

    expect(result.success).toBe(false);
  });

  test("exports the validated, deeply immutable bundled Tomato Soup recipe", () => {
    expect(validateRecipe(TOMATO_SOUP_RECIPE).success).toBe(true);
    expect(TOMATO_SOUP_RECIPE.roundDurationMs).toBe(DEFAULT_ROUND_DURATION_MS);
    expect(TOMATO_SOUP_RECIPE.ingredients).toEqual([
      { id: "tomato", kind: "TOMATO", count: 2 },
      { id: "onion", kind: "ONION", count: 1 },
    ]);
    expect(TOMATO_SOUP_RECIPE.steps.map(({ action }) => action)).toEqual([
      "CHOP", "CHOP", "ADD_TO_POT", "ADD_TO_POT", "SEASON", "BOIL", "MIX", "PLATE",
    ]);
    expect(Object.isFrozen(TOMATO_SOUP_RECIPE)).toBe(true);
    expect(Object.isFrozen(TOMATO_SOUP_RECIPE.ingredients)).toBe(true);
    expect(Object.isFrozen(TOMATO_SOUP_RECIPE.ingredients[0])).toBe(true);
    expect(Object.isFrozen(TOMATO_SOUP_RECIPE.steps)).toBe(true);
    expect(Object.isFrozen(TOMATO_SOUP_RECIPE.steps[0]?.dependsOn)).toBe(true);
    expect(() => {
      (TOMATO_SOUP_RECIPE.ingredients as unknown as Array<{ count: number }>)[0]!.count = 99;
    }).toThrow(TypeError);
  });
});
