import { type Client, type Room } from "@colyseus/core";

import type { Recipe } from "@cooking-game/recipe-schema";
import {
  KITCHEN_MESSAGES,
  parsePrivateRecipe,
  roundReadySchema,
  type PlayerRole,
  type PrivateRecipePayload,
} from "@cooking-game/shared";

export interface RecipeSystemAuthority {
  roleOf(sessionId: string): PlayerRole | undefined;
  roundStarted(): boolean;
}

export class RecipeSystem {
  private readonly payload: PrivateRecipePayload;

  constructor(
    private readonly room: Room,
    private readonly authority: RecipeSystemAuthority,
    recipe: Recipe,
  ) {
    const kindByIngredientId = new Map(
      recipe.ingredients.map((ingredient) => [ingredient.id, ingredient.kind]),
    );
    this.payload = parsePrivateRecipe({
      id: recipe.id,
      title: recipe.title,
      ingredients: recipe.ingredients.map(({ kind, count }) => ({ kind, count })),
      steps: recipe.steps.map((step) =>
        step.ingredientId === undefined
          ? { action: step.action }
          : { action: step.action, ingredientKind: kindByIngredientId.get(step.ingredientId) }
      ),
    });
  }

  register(): void {
    this.room.onMessage(KITCHEN_MESSAGES.roundReady, (client, rawPayload: unknown) => {
      if (!roundReadySchema.safeParse(rawPayload).success) return;
      this.sendToRecipeKeeper(client);
    });
  }

  roundDidStart(): void {
    for (const client of this.room.clients) this.sendToRecipeKeeper(client);
  }

  connected(client: Client): void {
    this.sendToRecipeKeeper(client);
  }

  private sendToRecipeKeeper(client: Client): void {
    if (!this.authority.roundStarted()) return;
    if (this.authority.roleOf(client.sessionId) !== "RECIPE_KEEPER") return;
    client.send(KITCHEN_MESSAGES.privateRecipe, this.payload);
  }
}
