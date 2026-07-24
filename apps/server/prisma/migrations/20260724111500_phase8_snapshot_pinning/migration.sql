ALTER TABLE "OwnedRecipe" ADD COLUMN "publishedDocumentJson" TEXT;
ALTER TABLE "RecipeTestToken" ADD COLUMN "snapshotJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "GameHistory" ADD COLUMN "recipeSnapshotJson" TEXT;

UPDATE "OwnedRecipe"
SET "publishedDocumentJson" = "documentJson"
WHERE "status" = 'PUBLISHED';

UPDATE "RecipeTestToken"
SET "snapshotJson" = (
  SELECT "documentJson" FROM "OwnedRecipe" WHERE "OwnedRecipe"."id" = "RecipeTestToken"."recipeId"
);
