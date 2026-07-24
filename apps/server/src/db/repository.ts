import type { Recipe } from "@cooking-game/recipe-schema";
import { validateRecipe } from "@cooking-game/recipe-schema";
import { createHash, randomBytes } from "node:crypto";

import type {
  Account,
  GameHistory,
  RecipeLicense,
  RecipeReportReason,
} from "../generated/prisma/client.js";
import type { DatabaseClient } from "./client.js";

export interface AccountPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  masterVolume: number;
  voiceVolume: number;
}

export interface NewAccount {
  username: string;
  normalizedUsername: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
}

export interface NewGameHistory {
  accountId: string;
  roundId: string;
  roomId: string;
  recipeId: string;
  recipeSnapshotJson: string;
  outcome: "WON" | "LOST";
  outcomeReason: string;
  completedStepCount: number;
  totalStepCount: number;
  durationMs: number;
  finishedAt: Date;
}

export interface OwnedRecipeRecord {
  id: string;
  title: string;
  document: Recipe;
  status: "DRAFT" | "PUBLISHED" | "REMOVED";
  license: RecipeLicense | null;
  publishedAt: Date | null;
  removedAt: Date | null;
  removalReason: string | null;
  publicationVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const publicAccountSelect = {
  id: true,
  username: true,
  normalizedUsername: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaRepository {
  constructor(private readonly database: DatabaseClient) {}

  createAccount(input: NewAccount): Promise<Account> {
    return this.database.account.create({ data: input });
  }

  findAccountByNormalizedUsername(normalizedUsername: string): Promise<Account | null> {
    return this.database.account.findUnique({ where: { normalizedUsername } });
  }

  findPublicAccount(accountId: string) {
    return this.database.account.findUnique({ where: { id: accountId }, select: publicAccountSelect });
  }

  async rotateSession(input: { accountId: string; tokenHash: string; expiresAt: Date }) {
    return this.database.$transaction(async (transaction) => {
      await transaction.session.deleteMany({ where: { accountId: input.accountId } });
      return transaction.session.create({ data: input });
    });
  }

  createSession(input: { accountId: string; tokenHash: string; expiresAt: Date }) {
    return this.database.session.create({ data: input });
  }

  findActiveSession(tokenHash: string, now: Date) {
    return this.database.session.findFirst({
      where: { tokenHash, expiresAt: { gt: now } },
      include: { account: true },
    });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.database.session.deleteMany({ where: { tokenHash } });
  }

  async deleteExpiredSessions(now: Date): Promise<void> {
    await this.database.session.deleteMany({ where: { expiresAt: { lte: now } } });
  }

  async getPreferences(accountId: string): Promise<AccountPreferences | null> {
    const account = await this.database.account.findUnique({
      where: { id: accountId },
      select: { reducedMotion: true, highContrast: true, masterVolume: true, voiceVolume: true },
    });
    return account;
  }

  async updatePreferences(accountId: string, preferences: AccountPreferences): Promise<AccountPreferences> {
    return this.database.account.update({
      where: { id: accountId },
      data: preferences,
      select: { reducedMotion: true, highContrast: true, masterVolume: true, voiceVolume: true },
    });
  }

  async recordGameHistoryOnce(input: NewGameHistory): Promise<boolean> {
    try {
      await this.database.gameHistory.create({ data: input });
      return true;
    } catch (error) {
      if (isPrismaError(error, "P2002")) return false;
      throw error;
    }
  }

  listGameHistory(accountId: string): Promise<Array<Omit<GameHistory, "recipeSnapshotJson">>> {
    return this.database.gameHistory.findMany({
      where: { accountId },
      omit: { recipeSnapshotJson: true },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  }

  async createOwnedRecipe(accountId: string, document: Recipe): Promise<OwnedRecipeRecord> {
    const row = await this.database.ownedRecipe.create({
      data: { accountId, title: document.title, documentJson: JSON.stringify(document) },
    });
    return deserializeOwnedRecipe(row);
  }

  async listOwnedRecipes(accountId: string): Promise<OwnedRecipeRecord[]> {
    const rows = await this.database.ownedRecipe.findMany({
      where: { accountId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map(deserializeOwnedRecipe);
  }

  async findOwnedRecipe(accountId: string, recipeId: string): Promise<OwnedRecipeRecord | null> {
    const row = await this.database.ownedRecipe.findFirst({ where: { id: recipeId, accountId } });
    return row ? deserializeOwnedRecipe(row) : null;
  }

  async updateOwnedRecipe(accountId: string, recipeId: string, document: Recipe): Promise<OwnedRecipeRecord | null> {
    const result = await this.database.ownedRecipe.updateMany({
      where: { id: recipeId, accountId, status: "DRAFT" },
      data: { title: document.title, documentJson: JSON.stringify(document) },
    });
    return result.count === 0 ? null : this.findOwnedRecipe(accountId, recipeId);
  }

  async deleteOwnedRecipe(accountId: string, recipeId: string): Promise<boolean> {
    const result = await this.database.ownedRecipe.deleteMany({ where: { id: recipeId, accountId, status: "DRAFT" } });
    return result.count === 1;
  }

  async publishOwnedRecipe(
    accountId: string,
    recipeId: string,
    license: RecipeLicense,
    publishedAt: Date,
  ): Promise<OwnedRecipeRecord | null> {
    const published = await this.database.$transaction(async (transaction) => {
      const draft = await transaction.ownedRecipe.findFirst({
        where: { id: recipeId, accountId, status: "DRAFT" },
        select: { documentJson: true },
      });
      if (!draft) return false;
      const result = await transaction.ownedRecipe.updateMany({
        where: { id: recipeId, accountId, status: "DRAFT" },
        data: {
          status: "PUBLISHED",
          license,
          publishedAt,
          publishedDocumentJson: draft.documentJson,
          removedAt: null,
          removalReason: null,
          publicationVersion: { increment: 1 },
        },
      });
      return result.count === 1;
    });
    return published ? this.findOwnedRecipe(accountId, recipeId) : null;
  }

  async unpublishOwnedRecipe(accountId: string, recipeId: string): Promise<OwnedRecipeRecord | null> {
    const result = await this.database.ownedRecipe.updateMany({
      where: { id: recipeId, accountId, status: "PUBLISHED" },
      data: { status: "DRAFT", publishedAt: null },
    });
    return result.count === 0 ? null : this.findOwnedRecipe(accountId, recipeId);
  }

  async listPublishedRecipes(input: { query?: string; cursor?: string; take?: number }) {
    const rows = await this.database.ownedRecipe.findMany({
      where: {
        status: "PUBLISHED",
        ...(input.query ? { title: { contains: input.query } } : {}),
        ...(input.cursor ? { id: { lt: input.cursor } } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(input.take ?? 20, 1), 50),
    });
    return rows.map(publicRecipeMetadata);
  }

  async findPublishedRecipe(recipeId: string) {
    const row = await this.database.ownedRecipe.findFirst({
      where: { id: recipeId, status: "PUBLISHED" },
    });
    return row?.publishedDocumentJson
      ? { ...publicRecipeMetadata(row), document: deserializeDocument(row.publishedDocumentJson) }
      : null;
  }

  async createRecipeReport(input: {
    recipeId: string;
    reporterAccountId: string;
    reason: RecipeReportReason;
    details: string;
  }) {
    try {
      return await this.database.recipeReport.create({ data: input });
    } catch (error) {
      if (isPrismaError(error, "P2002") || isPrismaError(error, "P2003")) return null;
      throw error;
    }
  }

  listOpenRecipeReports(take = 50) {
    return this.database.recipeReport.findMany({
      where: { status: "OPEN" },
      include: { recipe: { select: { id: true, title: true, status: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(take, 1), 100),
    });
  }

  async removePublishedRecipe(recipeId: string, reason: string, removedAt: Date): Promise<boolean> {
    const result = await this.database.ownedRecipe.updateMany({
      where: { id: recipeId, status: "PUBLISHED" },
      data: { status: "REMOVED", removedAt, removalReason: reason },
    });
    return result.count === 1;
  }

  async restoreRemovedRecipe(recipeId: string): Promise<boolean> {
    const result = await this.database.ownedRecipe.updateMany({
      where: { id: recipeId, status: "REMOVED" },
      data: { status: "DRAFT", license: null, publishedAt: null, removedAt: null, removalReason: null },
    });
    return result.count === 1;
  }

  async createPrivateTestToken(ownerAccountId: string, recipeId: string, expiresAt: Date) {
    const recipe = await this.database.ownedRecipe.findFirst({
      where: { id: recipeId, accountId: ownerAccountId, status: { not: "REMOVED" } },
      select: { id: true, documentJson: true },
    });
    if (!recipe) return null;
    const token = randomBytes(24).toString("base64url");
    await this.database.recipeTestToken.create({
      data: {
        tokenHash: hashOpaqueToken(token),
        recipeId,
        ownerAccountId,
        snapshotJson: recipe.documentJson,
        expiresAt,
      },
    });
    return { token, expiresAt };
  }

  async consumePrivateTestToken(token: string, now: Date) {
    const tokenHash = hashOpaqueToken(token);
    return this.database.$transaction(async (transaction) => {
      const row = await transaction.recipeTestToken.findFirst({
        where: { tokenHash, consumedAt: null, expiresAt: { gt: now }, recipe: { status: { not: "REMOVED" } } },
        include: { recipe: true },
      });
      if (!row) return null;
      const consumed = await transaction.recipeTestToken.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;
      return {
        recipeId: row.recipeId,
        ownerAccountId: row.ownerAccountId,
        document: deserializeDocument(row.snapshotJson),
      };
    });
  }
}

function deserializeOwnedRecipe(row: {
  id: string;
  title: string;
  documentJson: string;
  status: "DRAFT" | "PUBLISHED" | "REMOVED";
  license: RecipeLicense | null;
  publishedAt: Date | null;
  removedAt: Date | null;
  removalReason: string | null;
  publicationVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): OwnedRecipeRecord {
  return {
    id: row.id,
    title: row.title,
    document: deserializeDocument(row.documentJson),
    status: row.status,
    license: row.license,
    publishedAt: row.publishedAt,
    removedAt: row.removedAt,
    removalReason: row.removalReason,
    publicationVersion: row.publicationVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function deserializeDocument(documentJson: string): Recipe {
  const parsed = validateRecipe(JSON.parse(documentJson) as unknown);
  if (!parsed.success) throw new Error("Stored recipe document is invalid");
  return parsed.data;
}

function publicRecipeMetadata(row: {
  id: string;
  title: string;
  license: RecipeLicense | null;
  publishedAt: Date | null;
  publicationVersion: number;
  documentJson: string;
  publishedDocumentJson: string | null;
}) {
  const document = deserializeDocument(row.publishedDocumentJson ?? row.documentJson);
  return {
    id: row.id,
    slug: document.id,
    title: document.title,
    license: row.license,
    publishedAt: row.publishedAt,
    publicationVersion: row.publicationVersion,
    roundDurationMs: document.roundDurationMs,
    ingredients: document.ingredients.map(({ kind, count }) => ({ kind, count })),
  };
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
