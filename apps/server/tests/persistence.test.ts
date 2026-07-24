import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOMATO_SOUP_RECIPE } from "@cooking-game/recipe-schema";
import {
  createDatabaseClient,
  ensureDatabaseSchema,
  migrateDatabase,
  type DatabaseClient,
} from "../src/db/client.js";
import { PrismaRepository } from "../src/db/repository.js";

describe("PrismaRepository", () => {
  let directory: string;
  let database: DatabaseClient;
  let repository: PrismaRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "private-kitchen-phase5-"));
    database = createDatabaseClient(`file:${join(directory, "test.db")}`);
    await migrateDatabase(database);
    repository = new PrismaRepository(database);
  });

  afterEach(async () => {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  it("enforces normalized username uniqueness", async () => {
    await repository.createAccount({
      username: "Alice",
      normalizedUsername: "alice",
      displayName: "Alice",
      passwordHash: "first-hash",
      passwordSalt: "first-salt",
    });

    await expect(repository.createAccount({
      username: "ALICE",
      normalizedUsername: "alice",
      displayName: "Other Alice",
      passwordHash: "second-hash",
      passwordSalt: "second-salt",
    })).rejects.toMatchObject({ code: "P2002" });
  });

  it("stores sessions and resolves only unexpired hashes", async () => {
    const account = await createAccount(repository, "alice");
    const expiresAt = new Date("2026-08-01T00:00:00.000Z");
    await repository.createSession({ accountId: account.id, tokenHash: "opaque-hash", expiresAt });

    expect((await repository.findActiveSession("opaque-hash", new Date("2026-07-31T23:59:59.000Z")))?.account.id)
      .toBe(account.id);
    expect(await repository.findActiveSession("opaque-hash", expiresAt)).toBeNull();
    await repository.deleteSession("opaque-hash");
    expect(await repository.findActiveSession("opaque-hash", new Date("2026-07-31T00:00:00.000Z"))).toBeNull();
  });

  it("round-trips validated preference data", async () => {
    const account = await createAccount(repository, "prefs");
    expect(await repository.getPreferences(account.id)).toEqual({
      reducedMotion: false,
      highContrast: false,
      masterVolume: 100,
      voiceVolume: 100,
    });

    const preferences = { reducedMotion: true, highContrast: true, masterVolume: 35, voiceVolume: 60 };
    await repository.updatePreferences(account.id, preferences);
    expect(await repository.getPreferences(account.id)).toEqual(preferences);
  });

  it("persists account data after the SQLite client is closed and reopened", async () => {
    const account = await createAccount(repository, "restart-user");
    await repository.updatePreferences(account.id, {
      reducedMotion: true,
      highContrast: false,
      masterVolume: 42,
      voiceVolume: 73,
    });
    const sessionExpiresAt = new Date("2099-01-01T00:00:00.000Z");
    await repository.createSession({
      accountId: account.id,
      tokenHash: "restart-token-hash",
      expiresAt: sessionExpiresAt,
    });
    await repository.recordGameHistoryOnce({
      accountId: account.id,
      roundId: "restart-room:round-1",
      roomId: "restart-room",
      recipeId: "tomato-soup",
      recipeSnapshotJson: JSON.stringify(TOMATO_SOUP_RECIPE),
      outcome: "WON",
      outcomeReason: "COMPLETED",
      completedStepCount: 10,
      totalStepCount: 10,
      durationMs: 30_000,
      finishedAt: new Date("2026-07-23T00:00:00.000Z"),
    });
    const ownedRecipe = await repository.createOwnedRecipe(account.id, TOMATO_SOUP_RECIPE);

    await database.$disconnect();
    database = createDatabaseClient(`file:${join(directory, "test.db")}`);
    repository = new PrismaRepository(database);

    expect(await repository.findAccountByNormalizedUsername("restart-user")).toMatchObject({
      username: "restart-user",
      displayName: "restart-user",
    });
    expect(await repository.getPreferences(account.id)).toEqual({
      reducedMotion: true,
      highContrast: false,
      masterVolume: 42,
      voiceVolume: 73,
    });
    expect(await repository.findActiveSession(
      "restart-token-hash",
      new Date("2098-12-31T23:59:59.000Z"),
    )).toMatchObject({ account: { id: account.id }, expiresAt: sessionExpiresAt });
    expect(await repository.listGameHistory(account.id)).toEqual([
      expect.objectContaining({
        roundId: "restart-room:round-1",
        outcome: "WON",
        completedStepCount: 10,
      }),
    ]);
    expect(await repository.findOwnedRecipe(account.id, ownedRecipe.id)).toMatchObject({
      id: ownedRecipe.id,
      title: TOMATO_SOUP_RECIPE.title,
      document: TOMATO_SOUP_RECIPE,
    });
  });

  it("records a terminal round only once per account and round", async () => {
    const account = await createAccount(repository, "historian");
    const history = {
      accountId: account.id,
      roundId: "room-1:round-1",
      roomId: "room-1",
      recipeId: "tomato-soup",
      recipeSnapshotJson: JSON.stringify(TOMATO_SOUP_RECIPE),
      outcome: "WON" as const,
      outcomeReason: "COMPLETED",
      completedStepCount: 10,
      totalStepCount: 10,
      durationMs: 42_000,
      finishedAt: new Date("2026-07-22T12:00:00.000Z"),
    };

    expect(await repository.recordGameHistoryOnce(history)).toBe(true);
    expect(await repository.recordGameHistoryOnce(history)).toBe(false);
    expect(await repository.listGameHistory(account.id)).toHaveLength(1);
  });

  it("keeps owned recipes scoped to their owner", async () => {
    const owner = await createAccount(repository, "owner");
    const stranger = await createAccount(repository, "stranger");
    const created = await repository.createOwnedRecipe(owner.id, TOMATO_SOUP_RECIPE);

    expect((await repository.findOwnedRecipe(owner.id, created.id))?.document).toEqual(TOMATO_SOUP_RECIPE);
    expect(await repository.findOwnedRecipe(stranger.id, created.id)).toBeNull();
    expect(await repository.updateOwnedRecipe(stranger.id, created.id, TOMATO_SOUP_RECIPE)).toBeNull();
    expect(await repository.deleteOwnedRecipe(stranger.id, created.id)).toBe(false);
    expect(await repository.listOwnedRecipes(owner.id)).toHaveLength(1);
  });

  it("enforces recipe lifecycle, public filtering, reports, and hashed single-use test tokens", async () => {
    const owner = await createAccount(repository, "publisher");
    const reporter = await createAccount(repository, "reporter");
    const draft = await repository.createOwnedRecipe(owner.id, {
      ...TOMATO_SOUP_RECIPE,
      id: "summer-soup",
      title: "Summer Soup",
    });

    expect(draft).toMatchObject({ status: "DRAFT", license: null, publicationVersion: 0 });
    expect(await repository.listPublishedRecipes({ query: "summer" })).toEqual([]);

    const published = await repository.publishOwnedRecipe(owner.id, draft.id, "CC_BY_4_0", new Date("2026-07-24T10:00:00Z"));
    expect(published).toMatchObject({ status: "PUBLISHED", license: "CC_BY_4_0", publicationVersion: 1 });
    expect(await repository.listPublishedRecipes({ query: "summer" })).toEqual([
      expect.objectContaining({ id: draft.id, title: "Summer Soup" }),
    ]);

    await expect(repository.createRecipeReport({
      recipeId: draft.id,
      reporterAccountId: reporter.id,
      reason: "OTHER",
      details: "Please review this recipe.",
    })).resolves.toMatchObject({ status: "OPEN" });
    await expect(repository.createRecipeReport({
      recipeId: draft.id,
      reporterAccountId: reporter.id,
      reason: "OTHER",
      details: "Duplicate.",
    })).resolves.toBeNull();

    const issued = await repository.createPrivateTestToken(owner.id, draft.id, new Date("2026-07-24T10:05:00Z"));
    const storedTokens = await database.recipeTestToken.findMany();
    expect(storedTokens).toHaveLength(1);
    expect(storedTokens[0]?.tokenHash).not.toBe(issued.token);
    expect(await repository.consumePrivateTestToken(issued.token, new Date("2026-07-24T10:04:00Z")))
      .toMatchObject({ recipeId: draft.id, ownerAccountId: owner.id });
    expect(await repository.consumePrivateTestToken(issued.token, new Date("2026-07-24T10:04:01Z"))).toBeNull();

    await repository.removePublishedRecipe(draft.id, "Policy violation", new Date("2026-07-24T10:06:00Z"));
    expect(await repository.findPublishedRecipe(draft.id)).toBeNull();
  });

  it("pins publication and private-test documents as immutable snapshots", async () => {
    const owner = await createAccount(repository, "snapshot-owner");
    const original = {
      ...TOMATO_SOUP_RECIPE,
      id: "snapshot-soup",
      title: "Snapshot Soup",
    };
    const changed = { ...original, title: "Changed Soup" };
    const publishedDraft = await repository.createOwnedRecipe(owner.id, original);
    await repository.publishOwnedRecipe(
      owner.id,
      publishedDraft.id,
      "CC0_1_0",
      new Date("2026-07-24T11:00:00Z"),
    );
    await database.ownedRecipe.update({
      where: { id: publishedDraft.id },
      data: { title: changed.title, documentJson: JSON.stringify(changed) },
    });
    expect(await repository.findPublishedRecipe(publishedDraft.id)).toMatchObject({
      title: "Snapshot Soup",
      document: original,
    });

    const privateDraft = await repository.createOwnedRecipe(owner.id, {
      ...original,
      id: "private-snapshot-soup",
      title: "Private Snapshot Soup",
    });
    const issued = await repository.createPrivateTestToken(
      owner.id,
      privateDraft.id,
      new Date("2026-07-24T11:05:00Z"),
    );
    await repository.updateOwnedRecipe(owner.id, privateDraft.id, {
      ...original,
      id: "private-snapshot-soup",
      title: "Edited After Token",
    });
    expect((await repository.consumePrivateTestToken(
      issued!.token,
      new Date("2026-07-24T11:04:00Z"),
    ))?.document.title).toBe("Private Snapshot Soup");
  });

  it("does not bootstrap persistent databases outside the Prisma migration ledger", async () => {
    const freshDatabase = createDatabaseClient(`file:${join(directory, "fresh.db")}`);
    try {
      await expect(ensureDatabaseSchema(freshDatabase)).rejects.toThrow(
        "npm run prisma:migrate",
      );
      await expect(ensureDatabaseSchema(freshDatabase, { allowBootstrap: true })).resolves.toBeUndefined();
      expect(await freshDatabase.account.count()).toBe(0);
      await expect(ensureDatabaseSchema(freshDatabase)).rejects.toThrow(
        "checked-in Prisma migration",
      );
    } finally {
      await freshDatabase.$disconnect();
    }
  });
});

async function createAccount(repository: PrismaRepository, normalizedUsername: string) {
  return repository.createAccount({
    username: normalizedUsername,
    normalizedUsername,
    displayName: normalizedUsername,
    passwordHash: "hash",
    passwordSalt: "salt",
  });
}
