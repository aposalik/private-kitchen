import { describe, expect, test } from "vitest";

import {
  COOK_ACTIONS,
  COOKING_ERROR_CODES,
  KITCHEN_MESSAGES,
  KITCHEN_OBJECT_LOCATIONS,
  KITCHEN_OBJECT_PREPARATIONS,
  MAX_OBJECT_ID_LENGTH,
  MAX_PRIVATE_RECIPE_INGREDIENTS,
  MAX_PRIVATE_RECIPE_STEPS,
  MAX_PUBLIC_STEP_COUNT,
  MAX_ROUND_REMAINING_MS,
  ROUND_OUTCOME_REASONS,
  ROUND_STATUSES,
  createInitialKitchenObjects,
  cookActionSchema,
  cookingErrorSchema,
  roundReadySchema,
  publicRoundStateSchema,
  parsePrivateRecipe,
  privateRecipeSchema,
  type KitchenObjectState,
} from "../src/index.js";

describe("Phase 4 finite cooking protocol", () => {
  test("accepts exactly the finite action/object shapes", () => {
    expect(COOK_ACTIONS).toEqual([
      "CHOP",
      "ADD_TO_POT",
      "SEASON",
      "BOIL",
      "MIX",
      "PLATE",
    ]);

    for (const action of ["CHOP", "ADD_TO_POT"] as const) {
      expect(cookActionSchema.parse({
        action,
        actionSequence: 1,
        objectId: "ingredient-1",
      })).toEqual({ action, actionSequence: 1, objectId: "ingredient-1" });
      expect(cookActionSchema.safeParse({ action, actionSequence: 1 }).success).toBe(false);
      expect(cookActionSchema.safeParse({ action, actionSequence: 1, objectId: "" }).success).toBe(false);
      expect(cookActionSchema.safeParse({
        action,
        actionSequence: 1,
        objectId: "x".repeat(MAX_OBJECT_ID_LENGTH + 1),
      }).success).toBe(false);
    }

    for (const action of ["SEASON", "BOIL", "MIX", "PLATE"] as const) {
      expect(cookActionSchema.parse({ action, actionSequence: 1 })).toEqual({
        action,
        actionSequence: 1,
      });
      expect(cookActionSchema.safeParse({
        action,
        actionSequence: 1,
        objectId: "ingredient-1",
      }).success).toBe(false);
    }

    expect(cookActionSchema.safeParse({ action: "FRY", actionSequence: 1 }).success).toBe(false);
  });

  test("defines an exact untrusted COOK_ACTION ingress contract", () => {
    expect(KITCHEN_MESSAGES.cookAction).toBe("COOK_ACTION");
    for (const actionSequence of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(cookActionSchema.safeParse({ action: "MIX", actionSequence }).success).toBe(false);
    }
    expect(cookActionSchema.parse({
      action: "MIX",
      actionSequence: Number.MAX_SAFE_INTEGER,
    })).toBeTruthy();

    for (const forbidden of [
      { role: "BLIND_COOK" },
      { senderId: "forged" },
      { completedStepCount: 4 },
      { remainingMs: 300_000 },
      { outcomeReason: "COMPLETED" },
      { recipe: { id: "tomato-soup" } },
    ]) {
      expect(cookActionSchema.safeParse({
        action: "MIX",
        actionSequence: 1,
        ...forbidden,
      }).success).toBe(false);
    }
    expect(cookActionSchema.safeParse(
      Object.assign(Object.create({ role: "BLIND_COOK" }), {
        action: "MIX",
        actionSequence: 1,
      }),
    ).success).toBe(false);
  });

  test("defines finite cooking responses and an idempotent empty ROUND_READY payload", () => {
    expect(KITCHEN_MESSAGES).toMatchObject({
      cookingError: "COOKING_ERROR",
      roundReady: "ROUND_READY",
      privateRecipe: "PRIVATE_RECIPE",
    });
    expect(COOKING_ERROR_CODES).toEqual([
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
    ]);
    for (const code of COOKING_ERROR_CODES) {
      expect(cookingErrorSchema.parse({ code, message: "Action rejected" })).toEqual({
        code,
        message: "Action rejected",
      });
    }
    expect(cookingErrorSchema.safeParse({ code: "FREE_TEXT", message: "forged" }).success).toBe(false);

    expect(roundReadySchema.parse({})).toEqual({});
    expect(roundReadySchema.safeParse({ ready: true }).success).toBe(false);
    expect(roundReadySchema.safeParse(Object.create({ ready: true })).success).toBe(false);
  });

  test("adds finite preparation and location without removing Phase 2 object fields", () => {
    expect(KITCHEN_OBJECT_PREPARATIONS).toEqual(["RAW", "CHOPPED", "RUINED"]);
    expect(KITCHEN_OBJECT_LOCATIONS).toEqual(["COUNTER", "POT"]);

    const compatibleObject = {
      id: "ingredient-1",
      kind: "TOMATO",
      label: "Tomato",
      x: 10,
      y: 20,
      heldBy: "player-1",
      preparation: "CHOPPED",
      location: "COUNTER",
    } satisfies KitchenObjectState;
    expect(compatibleObject.heldBy).toBe("player-1");

    for (const object of createInitialKitchenObjects("phase-4-object-state")) {
      expect(object).toMatchObject({ preparation: "RAW", location: "COUNTER" });
      expect(object).toEqual(expect.objectContaining({
        id: expect.any(String),
        kind: expect.any(String),
        label: expect.any(String),
        x: expect.any(Number),
        y: expect.any(Number),
      }));
    }
  });

  test("strictly validates bounded public round state without private recipe data", () => {
    expect(ROUND_STATUSES).toEqual(["NOT_STARTED", "RUNNING", "PAUSED", "WON", "LOST"]);
    expect(ROUND_OUTCOME_REASONS).toEqual(["NONE", "COMPLETED", "TIME_EXPIRED"]);
    const valid = {
      roundStatus: "RUNNING",
      remainingMs: 300_000,
      completedStepCount: 2,
      totalStepCount: 10,
      outcomeReason: "NONE",
    } as const;
    expect(publicRoundStateSchema.parse(valid)).toEqual(valid);

    for (const invalid of [
      { ...valid, roundStatus: "WAITING" },
      { ...valid, outcomeReason: "ABANDONED" },
      { ...valid, remainingMs: -1 },
      { ...valid, remainingMs: 1.5 },
      { ...valid, remainingMs: MAX_ROUND_REMAINING_MS + 1 },
      { ...valid, completedStepCount: -1 },
      { ...valid, completedStepCount: 3, totalStepCount: 2 },
      { ...valid, totalStepCount: MAX_PUBLIC_STEP_COUNT + 1 },
      { ...valid, recipeTitle: "Tomato Soup" },
      { ...valid, ingredients: [{ kind: "TOMATO", count: 2 }] },
      { ...valid, steps: [{ action: "CHOP" }] },
      { ...valid, privateInstructions: "Chop the tomato" },
    ]) {
      expect(publicRoundStateSchema.safeParse(invalid).success).toBe(false);
    }
  });

  test("strictly parses only bounded trusted private recipe payloads", () => {
    const valid = {
      id: "tomato-soup",
      title: "Tomato Soup",
      ingredients: [
        { kind: "TOMATO", count: 2 },
        { kind: "ONION", count: 1 },
      ],
      steps: [
        { action: "CHOP", ingredientKind: "TOMATO" },
        { action: "ADD_TO_POT", ingredientKind: "TOMATO" },
        { action: "SEASON" },
        { action: "BOIL" },
        { action: "MIX" },
        { action: "PLATE" },
      ],
    } as const;
    expect(parsePrivateRecipe(valid)).toEqual(valid);
    expect(parsePrivateRecipe({ ...valid, id: "garden-soup", title: "Garden Soup" }))
      .toMatchObject({ id: "garden-soup", title: "Garden Soup" });

    for (const malformed of [
      { ...valid, id: "Mystery Stew" },
      { ...valid, title: "" },
      { ...valid, role: "RECIPE_KEEPER" },
      { ...valid, senderId: "player-1" },
      { ...valid, remainingMs: 10 },
      { ...valid, outcomeReason: "COMPLETED" },
      { ...valid, ingredients: [] },
      { ...valid, ingredients: Array.from({ length: MAX_PRIVATE_RECIPE_INGREDIENTS + 1 }, () => ({ kind: "TOMATO", count: 1 })) },
      { ...valid, ingredients: [{ kind: "TOMATO", count: 0 }] },
      { ...valid, ingredients: [{ kind: "GARLIC", count: 1 }] },
      { ...valid, ingredients: [{ kind: "TOMATO", count: 1, id: "client-id" }] },
      { ...valid, steps: [] },
      { ...valid, steps: Array.from({ length: MAX_PRIVATE_RECIPE_STEPS + 1 }, () => ({ action: "MIX" })) },
      { ...valid, steps: [{ action: "FRY" }] },
      { ...valid, steps: [{ action: "CHOP" }] },
      { ...valid, steps: [{ action: "MIX", ingredientKind: "TOMATO" }] },
      { ...valid, steps: [{ action: "MIX", instruction: "secret text" }] },
      Object.assign(Object.create({ role: "RECIPE_KEEPER" }), valid),
    ]) {
      expect(privateRecipeSchema.safeParse(malformed).success).toBe(false);
    }
  });
});
