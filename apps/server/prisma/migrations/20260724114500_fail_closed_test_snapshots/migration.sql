PRAGMA foreign_keys=OFF;

CREATE TABLE "new_RecipeTestToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "ownerAccountId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshotJson" TEXT NOT NULL,
  CONSTRAINT "RecipeTestToken_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "OwnedRecipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeTestToken_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_RecipeTestToken" (
  "id", "tokenHash", "recipeId", "ownerAccountId", "expiresAt", "consumedAt", "createdAt", "snapshotJson"
)
SELECT
  "id", "tokenHash", "recipeId", "ownerAccountId", "expiresAt", "consumedAt", "createdAt", "snapshotJson"
FROM "RecipeTestToken";

DROP TABLE "RecipeTestToken";
ALTER TABLE "new_RecipeTestToken" RENAME TO "RecipeTestToken";

CREATE UNIQUE INDEX "RecipeTestToken_tokenHash_key" ON "RecipeTestToken"("tokenHash");
CREATE INDEX "RecipeTestToken_expiresAt_idx" ON "RecipeTestToken"("expiresAt");
CREATE INDEX "RecipeTestToken_ownerAccountId_recipeId_idx" ON "RecipeTestToken"("ownerAccountId", "recipeId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
