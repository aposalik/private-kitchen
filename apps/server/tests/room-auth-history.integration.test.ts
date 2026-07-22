import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { afterEach, describe, expect, it } from "vitest";

import { KITCHEN_ROOM_NAME, type KitchenRoomState } from "@cooking-game/shared";
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
