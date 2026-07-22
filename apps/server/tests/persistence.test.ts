import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOMATO_SOUP_RECIPE } from "@cooking-game/recipe-schema";
import { createDatabaseClient, migrateDatabase, type DatabaseClient } from "../src/db/client.js";
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

  it("records a terminal round only once per account and round", async () => {
    const account = await createAccount(repository, "historian");
    const history = {
      accountId: account.id,
      roundId: "room-1:round-1",
      roomId: "room-1",
      recipeId: "tomato-soup",
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
