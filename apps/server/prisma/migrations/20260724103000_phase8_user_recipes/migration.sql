ALTER TABLE "OwnedRecipe" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "OwnedRecipe" ADD COLUMN "license" TEXT;
ALTER TABLE "OwnedRecipe" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "OwnedRecipe" ADD COLUMN "removedAt" DATETIME;
ALTER TABLE "OwnedRecipe" ADD COLUMN "removalReason" TEXT;
ALTER TABLE "OwnedRecipe" ADD COLUMN "publicationVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "OwnedRecipe_status_publishedAt_id_idx" ON "OwnedRecipe"("status", "publishedAt", "id");

CREATE TABLE "RecipeReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeId" TEXT NOT NULL,
  "reporterAccountId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  CONSTRAINT "RecipeReport_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "OwnedRecipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeReport_reporterAccountId_fkey" FOREIGN KEY ("reporterAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RecipeReport_reporterAccountId_recipeId_key" ON "RecipeReport"("reporterAccountId", "recipeId");
CREATE INDEX "RecipeReport_status_createdAt_id_idx" ON "RecipeReport"("status", "createdAt", "id");
CREATE INDEX "RecipeReport_recipeId_createdAt_idx" ON "RecipeReport"("recipeId", "createdAt");

CREATE TABLE "RecipeTestToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "ownerAccountId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeTestToken_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "OwnedRecipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeTestToken_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RecipeTestToken_tokenHash_key" ON "RecipeTestToken"("tokenHash");
CREATE INDEX "RecipeTestToken_expiresAt_idx" ON "RecipeTestToken"("expiresAt");
CREATE INDEX "RecipeTestToken_ownerAccountId_recipeId_idx" ON "RecipeTestToken"("ownerAccountId", "recipeId");
