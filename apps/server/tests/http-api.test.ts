import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOMATO_SOUP_RECIPE } from "@cooking-game/recipe-schema";
import { createDatabaseClient, migrateDatabase, type DatabaseClient } from "../src/db/client.js";
import { PrismaRepository } from "../src/db/repository.js";
import { createKitchenHttpApp } from "../src/http/app.js";

const ORIGIN = "http://127.0.0.1:5173";
const PASSWORD = "correct horse battery staple";

describe("account HTTP API", () => {
  let directory: string;
  let database: DatabaseClient;
  let repository: PrismaRepository;
  let server: Server;
  let baseUrl: string;
  let now: Date;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "private-kitchen-http-"));
    database = createDatabaseClient(`file:${join(directory, "test.db")}`);
    await migrateDatabase(database);
    repository = new PrismaRepository(database);
    now = new Date("2026-07-22T12:00:00.000Z");
    const app = createKitchenHttpApp({
      repository,
      allowedOrigins: [ORIGIN],
      now: () => now,
      sessionTtlMs: 60_000,
      scrypt: { cost: 1_024, blockSize: 8, parallelization: 1, keyLength: 32, maxmem: 16 * 1_024 * 1_024 },
      authRateLimit: { attempts: 2, windowMs: 60_000 },
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP test server failed to bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  it("registers, normalizes identity, restores from an HttpOnly strict cookie, and rejects duplicates", async () => {
    const registered = await post("/api/auth/register", {
      username: "  Alice_01 ", displayName: "Alice", password: PASSWORD,
    });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toEqual({ account: { username: "Alice_01", displayName: "Alice" } });
    const cookie = sessionCookie(registered);
    expect(registered.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(registered.headers.get("set-cookie")).toMatch(/SameSite=Strict/i);
    expect(registered.headers.get("set-cookie")).toMatch(/Path=\//i);
    expect(registered.headers.get("set-cookie")).toMatch(/Max-Age=60/i);
    expect(cookie).not.toMatch(/password|alice/i);

    const me = await get("/api/auth/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ account: { username: "Alice_01", displayName: "Alice" } });

    const duplicate = await post("/api/auth/register", {
      username: "ALICE_01", displayName: "Other", password: PASSWORD,
    });
    expect(duplicate.status).toBe(409);
  });

  it("enforces password policy and returns generic invalid-login errors", async () => {
    const weak = await post("/api/auth/register", { username: "shorty", displayName: "Short", password: "too short" });
    expect(weak.status).toBe(400);
    await register("known-user");

    const unknown = await post("/api/auth/login", { username: "missing-user", password: PASSWORD });
    const wrong = await post("/api/auth/login", { username: "known-user", password: `${PASSWORD}!` });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("rotates login sessions, expires them, revokes logout, and clears invalid cookies", async () => {
    const firstCookie = await register("rotate-me");
    const login = await post("/api/auth/login", { username: "ROTATE-ME", password: PASSWORD });
    const secondCookie = sessionCookie(login);
    expect(secondCookie).not.toBe(firstCookie);
    expect((await get("/api/auth/me", firstCookie)).status).toBe(401);

    now = new Date(now.getTime() + 60_000);
    const expired = await get("/api/auth/me", secondCookie);
    expect(expired.status).toBe(401);
    expect(expired.headers.get("set-cookie")).toMatch(/Max-Age=0/i);

    now = new Date("2026-07-22T13:00:00.000Z");
    const freshCookie = sessionCookie(await post("/api/auth/login", { username: "rotate-me", password: PASSWORD }));
    expect((await post("/api/auth/logout", undefined, freshCookie)).status).toBe(204);
    expect((await get("/api/auth/me", freshCookie)).status).toBe(401);
  });

  it("rejects hostile origins, malformed strict payloads, oversized JSON, and bounded auth attempts", async () => {
    const hostile = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ username: "attacker", displayName: "Attacker", password: PASSWORD }),
    });
    expect(hostile.status).toBe(403);

    expect((await post("/api/auth/register", {
      username: "extra-field", displayName: "Extra", password: PASSWORD, admin: true,
    })).status).toBe(400);
    expect((await postRaw("/api/auth/register", "{" )).status).toBe(400);
    expect((await postRaw("/api/auth/register", JSON.stringify({ padding: "x".repeat(20_000) }))).status).toBe(413);

    expect((await post("/api/auth/login", { username: "limited", password: PASSWORD })).status).toBe(401);
    expect((await post("/api/auth/login", { username: "limited", password: PASSWORD })).status).toBe(401);
    expect((await post("/api/auth/login", { username: "limited", password: PASSWORD })).status).toBe(429);
  });

  it("authorizes preferences and preserves storage after invalid updates", async () => {
    expect((await get("/api/account/preferences")).status).toBe(401);
    const cookie = await register("preferences-user");
    const updated = await patch("/api/account/preferences", {
      reducedMotion: true, highContrast: false, masterVolume: 25, voiceVolume: 75,
    }, cookie);
    expect(updated.status).toBe(200);
    expect((await patch("/api/account/preferences", {
      reducedMotion: false, highContrast: false, masterVolume: 101, voiceVolume: 0,
    }, cookie)).status).toBe(400);
    expect(await (await get("/api/account/preferences", cookie)).json()).toEqual({
      preferences: { reducedMotion: true, highContrast: false, masterVolume: 25, voiceVolume: 75 },
    });
  });

  it("serves bounded account history only to its account", async () => {
    const cookie = await register("history-user");
    const account = await repository.findAccountByNormalizedUsername("history-user");
    await repository.recordGameHistoryOnce({
      accountId: account!.id, roundId: "room:round", roomId: "room", recipeId: "tomato-soup",
      outcome: "LOST", outcomeReason: "TIME_EXPIRED", completedStepCount: 4, totalStepCount: 10,
      durationMs: 60_000, finishedAt: now,
    });
    const response = await get("/api/account/history", cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as { history: Array<Record<string, unknown>> };
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ outcome: "LOST", completedStepCount: 4 });
    expect(body.history[0]).not.toHaveProperty("accountId");
  });

  it("validates recipe documents and owner-scopes every recipe operation", async () => {
    const ownerCookie = await register("recipe-owner");
    const strangerCookie = await register("recipe-stranger");
    const created = await post("/api/account/recipes", { document: TOMATO_SOUP_RECIPE }, ownerCookie);
    expect(created.status).toBe(201);
    const body = await created.json() as { recipe: { id: string } };
    const recipeUrl = `/api/account/recipes/${body.recipe.id}`;
    expect((await get(recipeUrl, ownerCookie)).status).toBe(200);
    expect((await get(recipeUrl, strangerCookie)).status).toBe(404);
    expect((await patch(recipeUrl, { document: { ...TOMATO_SOUP_RECIPE, schemaVersion: 99 } }, ownerCookie)).status).toBe(400);
    expect((await fetch(`${baseUrl}${recipeUrl}`, { method: "DELETE", headers: headers(strangerCookie) })).status).toBe(404);
    expect((await fetch(`${baseUrl}${recipeUrl}`, { method: "DELETE", headers: headers(ownerCookie) })).status).toBe(204);
  });

  function headers(cookie?: string): Record<string, string> {
    return { origin: ORIGIN, ...(cookie ? { cookie } : {}) };
  }

  function get(path: string, cookie?: string) {
    return fetch(`${baseUrl}${path}`, { headers: headers(cookie) });
  }

  function post(path: string, body?: unknown, cookie?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { ...headers(cookie), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  function postRaw(path: string, body: string) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { ...headers(), "content-type": "application/json" }, body,
    });
  }

  function patch(path: string, body: unknown, cookie?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: "PATCH", headers: { ...headers(cookie), "content-type": "application/json" }, body: JSON.stringify(body),
    });
  }

  async function register(username: string): Promise<string> {
    const response = await post("/api/auth/register", { username, displayName: username, password: PASSWORD });
    expect(response.status).toBe(201);
    return sessionCookie(response);
  }
});

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";", 1)[0]!;
}
