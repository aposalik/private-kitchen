PRAGMA foreign_keys=ON;

CREATE TABLE "Account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "normalizedUsername" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "passwordSalt" TEXT NOT NULL,
  "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
  "highContrast" BOOLEAN NOT NULL DEFAULT false,
  "masterVolume" INTEGER NOT NULL DEFAULT 100,
  "voiceVolume" INTEGER NOT NULL DEFAULT 100,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Account_normalizedUsername_key" ON "Account"("normalizedUsername");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE TABLE "GameHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "outcomeReason" TEXT NOT NULL,
  "completedStepCount" INTEGER NOT NULL,
  "totalStepCount" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "finishedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameHistory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GameHistory_accountId_roundId_key" ON "GameHistory"("accountId", "roundId");
CREATE INDEX "GameHistory_accountId_finishedAt_idx" ON "GameHistory"("accountId", "finishedAt");

CREATE TABLE "OwnedRecipe" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "documentJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OwnedRecipe_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OwnedRecipe_accountId_updatedAt_idx" ON "OwnedRecipe"("accountId", "updatedAt");
