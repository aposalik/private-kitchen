import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const glbAssets = [
  "apps/client/public/assets/3d/sushi/environment/Environment_KitchenRoom.glb",
  "apps/client/public/assets/3d/sushi/environment/Environment_Stove.glb",
  "apps/client/public/assets/3d/sushi/environment/Environment_Cabinets.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Tomato.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Potato.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Carrot.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Onion.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Apple.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Cabbage.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Cucumber.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Egg.glb",
  "apps/client/public/assets/3d/sushi/food/FoodIngredient_Eggplant.glb"
];

test("Babylon GLB assets referenced by the kitchen are present and valid", () => {
  for (const relativePath of glbAssets) {
    const bytes = readFileSync(resolve(root, relativePath));
    assert.equal(
      bytes.subarray(0, 4).toString("ascii"),
      "glTF",
      `${relativePath} must contain a binary glTF file`
    );
  }
});
