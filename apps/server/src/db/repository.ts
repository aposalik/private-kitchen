import type { Recipe } from "@cooking-game/recipe-schema";
import { validateRecipe } from "@cooking-game/recipe-schema";

import type { Account, GameHistory } from "../generated/prisma/client.js";
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

  listGameHistory(accountId: string): Promise<GameHistory[]> {
    return this.database.gameHistory.findMany({
      where: { accountId },
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
      where: { id: recipeId, accountId },
      data: { title: document.title, documentJson: JSON.stringify(document) },
    });
    return result.count === 0 ? null : this.findOwnedRecipe(accountId, recipeId);
  }

  async deleteOwnedRecipe(accountId: string, recipeId: string): Promise<boolean> {
    const result = await this.database.ownedRecipe.deleteMany({ where: { id: recipeId, accountId } });
    return result.count === 1;
  }
}

function deserializeOwnedRecipe(row: {
  id: string;
  title: string;
  documentJson: string;
  createdAt: Date;
  updatedAt: Date;
}): OwnedRecipeRecord {
  const parsed = validateRecipe(JSON.parse(row.documentJson) as unknown);
  if (!parsed.success) throw new Error("Stored recipe document is invalid");
  return { id: row.id, title: row.title, document: parsed.data, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
