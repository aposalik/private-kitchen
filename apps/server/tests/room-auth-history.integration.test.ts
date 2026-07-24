import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  KITCHEN_MESSAGES,
  KITCHEN_ROOM_NAME,
  type CookingErrorPayload,
  type KitchenRoomState,
} from "@cooking-game/shared";
import { startKitchenServer, type RunningKitchenServer } from "../src/index.js";

describe("room authentication and authoritative history", () => {
  let running: RunningKitchenServer | undefined;
  let directory: string | undefined;
  const rooms: ClientRoom<KitchenRoomState>[] = [];

  afterEach(async () => {
    await Promise.allSettled(rooms.splice(0).map((room) => room.connection.isOpen ? room.leave() : Promise.resolve()));
    await running?.shutdown();
    if (directory) await rm(directory, { recursive: true, force: true });
    running = undefined;
    directory = undefined;
  });

  it("resolves account cookies and records one server-owned terminal result per authenticated participant", async () => {
    directory = await mkdtemp(join(tmpdir(), "private-kitchen-room-auth-"));
    running = await startKitchenServer({
      port: 0,
      databaseUrl: `file:${join(directory, "room.db")}`,
      roundDurationMs: 80,
    });
    const httpUrl = running.endpoint.replace(/^ws:/, "http:");
    const firstCookie = await register(httpUrl, "history-one");
    const secondCookie = await register(httpUrl, "history-two");

    const first = await new Client(running.endpoint, { headers: { cookie: firstCookie } })
      .create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "One" });
    rooms.push(first);
    rooms.push(await new Client(running.endpoint, { headers: { cookie: secondCookie } })
      .joinById<KitchenRoomState>(first.roomId, { displayName: "Two" }));
    rooms.push(await new Client(running.endpoint, { headers: { cookie: "pk_session=invalid" } })
      .joinById<KitchenRoomState>(first.roomId, { displayName: "Guest" }));

    await waitForState(first, (state) => state.roundStatus === "LOST");
    await expect.poll(async () => (await history(httpUrl, firstCookie)).length).toBe(1);
    await expect.poll(async () => (await history(httpUrl, secondCookie)).length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await history(httpUrl, firstCookie)).toHaveLength(1);
    expect(await history(httpUrl, secondCookie)).toHaveLength(1);
    expect((await history(httpUrl, firstCookie))[0]).toMatchObject({
      roomId: first.roomId,
      outcome: "LOST",
      outcomeReason: "TIME_EXPIRED",
    });

    const publicSnapshot = JSON.stringify(first.state.toJSON());
    expect(publicSnapshot).not.toContain("history-one");
    expect(publicSnapshot).not.toContain("history-two");
    expect(publicSnapshot).not.toContain("pk_session");
  });

  it("drops an expired account association when a reserved seat reconnects", async () => {
    directory = await mkdtemp(join(tmpdir(), "private-kitchen-room-expiry-"));
    let now = new Date("2026-07-22T12:00:00.000Z");
    running = await startKitchenServer({
      port: 0,
      databaseUrl: `file:${join(directory, "room.db")}`,
      roundDurationMs: 500,
      reconnectionGraceSeconds: 2,
      sessionTtlMs: 1_000,
      now: () => now,
    });
    const httpUrl = running.endpoint.replace(/^ws:/, "http:");
    const cookie = await register(httpUrl, "expiring-player");
    const authenticated = await new Client(running.endpoint, { headers: { cookie } })
      .create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "Authenticated" });
    rooms.push(authenticated);
    rooms.push(await new Client(running.endpoint).joinById<KitchenRoomState>(authenticated.roomId, { displayName: "Guest Two" }));
    rooms.push(await new Client(running.endpoint).joinById<KitchenRoomState>(authenticated.roomId, { displayName: "Guest Three" }));
    await waitForState(authenticated, (state) => state.roundStatus === "RUNNING");

    const token = authenticated.reconnectionToken;
    authenticated.reconnection.enabled = false;
    authenticated.connection.close();
    await waitForState(rooms[1]!, (state) => state.roundStatus === "PAUSED");
    now = new Date(now.getTime() + 1_001);
    const reconnected = await new Client(running.endpoint, { headers: { cookie } }).reconnect<KitchenRoomState>(token);
    rooms.splice(0, 1, reconnected);
    await waitForState(reconnected, (state) => state.roundStatus === "LOST");

    const freshCookie = await login(httpUrl, "expiring-player");
    expect(await history(httpUrl, freshCookie)).toHaveLength(0);
  });

  it("resolves one published custom recipe for provisioning, timer, keeper privacy, and history", async () => {
    directory = await mkdtemp(join(tmpdir(), "private-kitchen-custom-recipe-"));
    running = await startKitchenServer({
      port: 0,
      databaseUrl: `file:${join(directory, "room.db")}`,
    });
    const httpUrl = running.endpoint.replace(/^ws:/, "http:");
    const cookie = await register(httpUrl, "custom-owner");
    const document = {
      schemaVersion: 1,
      id: "carrot-course",
      title: "Carrot Course",
      roundDurationMs: 1_000,
      ingredients: [{ id: "carrot", kind: "CARROT", count: 16 }],
      steps: [
        { id: "chop-carrot", action: "CHOP", ingredientId: "carrot", dependsOn: [] },
        { id: "add-carrot", action: "ADD_TO_POT", ingredientId: "carrot", dependsOn: ["chop-carrot"] },
        { id: "season", action: "SEASON", dependsOn: ["add-carrot"] },
        { id: "boil", action: "BOIL", dependsOn: ["season"] },
        { id: "mix", action: "MIX", dependsOn: ["boil"] },
        { id: "plate", action: "PLATE", dependsOn: ["mix"] },
      ],
    };
    const created = await apiPost(httpUrl, "/api/account/recipes", { document }, cookie);
    const recipeId = (await created.json() as { recipe: { id: string } }).recipe.id;
    expect((await apiPost(httpUrl, `/api/account/recipes/${recipeId}/publish`, {
      license: "CC0_1_0",
    }, cookie)).status).toBe(200);

    const first = await new Client(running.endpoint, { headers: { cookie } })
      .create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "One", recipeId });
    rooms.push(first);
    const keeperMessages: unknown[] = [];
    const second = await new Client(running.endpoint).joinById<KitchenRoomState>(
      first.roomId,
      { displayName: "Two" },
    );
    second.onMessage(KITCHEN_MESSAGES.privateRecipe, (message) => keeperMessages.push(message));
    rooms.push(second);
    rooms.push(await new Client(running.endpoint).joinById<KitchenRoomState>(
      first.roomId,
      { displayName: "Three" },
    ));

    await waitForState(first, (state) => state.roundStatus === "RUNNING");
    expect(first.state).toMatchObject({ totalStepCount: 36 });
    expect(first.state.remainingMs).toBeLessThanOrEqual(1_000);
    const objects = Array.from(first.state.objects.values());
    expect(objects).toHaveLength(16);
    expect(objects.every(({ kind }) => kind === "CARROT")).toBe(true);

    first.send(KITCHEN_MESSAGES.pickUp, { objectId: objects[0]!.id });
    await waitForState(first, (state) =>
      state.objects.get(objects[0]!.id)?.heldBy === first.sessionId
    );
    const dependencyError = nextMessage<CookingErrorPayload>(
      first,
      KITCHEN_MESSAGES.cookingError,
    );
    first.send(KITCHEN_MESSAGES.cookAction, {
      action: "ADD_TO_POT",
      actionSequence: 1,
      objectId: objects[0]!.id,
    });
    await expect(dependencyError).resolves.toMatchObject({ code: "OUT_OF_ORDER" });
    first.send(KITCHEN_MESSAGES.cookAction, {
      action: "CHOP",
      actionSequence: 2,
      objectId: objects[0]!.id,
    });
    await waitForState(first, (state) => state.completedStepCount === 1);
    first.send(KITCHEN_MESSAGES.cookAction, {
      action: "CHOP",
      actionSequence: 3,
      objectId: objects[0]!.id,
    });
    await waitForState(first, (state) =>
      state.completedStepCount === 0
      && state.objects.size === 16
      && !state.objects.has(objects[0]!.id)
    );
    await expect.poll(() => keeperMessages.length).toBe(1);
    expect(keeperMessages[0]).toMatchObject({ id: "carrot-course", title: "Carrot Course" });
    expect(JSON.stringify(first.state.toJSON())).not.toContain("chop-carrot");

    await waitForState(first, (state) => state.roundStatus === "LOST");
    await expect.poll(async () => (await history(httpUrl, cookie))[0]?.recipeId).toBe("carrot-course");
    const recordedHistory = await history(httpUrl, cookie);
    expect(recordedHistory[0]).not.toHaveProperty("recipeSnapshotJson");
    expect(JSON.stringify(recordedHistory)).not.toContain("chop-carrot");
    await expect(new Client(running.endpoint).create(KITCHEN_ROOM_NAME, {
      displayName: "Invalid",
      recipeId: "missing-record",
    })).rejects.toThrow();
  });
});

async function register(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username, displayName: username, password: "correct horse battery staple" }),
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

function apiPost(baseUrl: string, path: string, body: unknown, cookie: string) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie },
    body: JSON.stringify(body),
  });
}

async function login(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username, password: "correct horse battery staple" }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function history(baseUrl: string, cookie: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/api/account/history`, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json() as { history: Array<Record<string, unknown>> }).history;
}

function nextMessage<T>(room: ClientRoom<KitchenRoomState>, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2_000);
    const unsubscribe = room.onMessage(type, (payload) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(payload as T);
    });
  });
}

async function waitForState(
  room: ClientRoom<KitchenRoomState>,
  predicate: (state: KitchenRoomState) => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  if (predicate(room.state)) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for room state")), timeoutMs);
    const subscription = room.onStateChange((state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      subscription.remove();
      resolve();
    });
  });
}
