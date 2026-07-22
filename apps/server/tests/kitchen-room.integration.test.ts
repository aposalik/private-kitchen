import { Client, MatchMakeError, type Room as ClientRoom } from "@colyseus/sdk";
import { ErrorCode } from "@colyseus/core";
import { afterEach, describe, expect, test } from "vitest";

import {
  COMMUNICATION_MESSAGES,
  KITCHEN_MESSAGES,
  KITCHEN_ROOM_NAME,
  type InteractionErrorPayload,
  type KitchenRoomState,
} from "@cooking-game/shared";
import { startKitchenServer, type RunningKitchenServer } from "../src/index.js";

describe("KitchenRoom capacity", () => {
  let running: RunningKitchenServer | undefined;
  const rooms: ClientRoom<KitchenRoomState>[] = [];
  const pushRooms = rooms.push.bind(rooms);
  rooms.push = (...added) => {
    for (const room of added) registerPhase3NoopHandlers(room);
    return pushRooms(...added);
  };

  afterEach(async () => {
    await Promise.allSettled(
      rooms.splice(0).map((room) =>
        room.connection.isOpen ? room.leave() : Promise.resolve(),
      ),
    );
    await running?.shutdown();
    running = undefined;
  });

  test("server authority rejects a fourth client", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    const first = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Player One",
    });
    rooms.push(first);

    for (const displayName of ["Player Two", "Player Three"]) {
      rooms.push(
        await client.joinById<KitchenRoomState>(first.roomId, { displayName }),
      );
    }

    await expect(
      client.joinById(first.roomId, { displayName: "Player Four" }),
    ).rejects.toThrow();
  });

  test("fewer than three connected players remain waiting", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);
    const first = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Player One",
    });
    rooms.push(first);
    rooms.push(
      await client.joinById<KitchenRoomState>(first.roomId, {
        displayName: "Player Two",
      }),
    );

    await waitForState(first, (state) => state.connectedCount === 2);
    expect(first.state.status).toBe("WAITING");
  });

  test("three connected players receive unique roles and become ready", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);
    const first = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Player One",
    });
    rooms.push(first);
    for (const displayName of ["Player Two", "Player Three"]) {
      rooms.push(
        await client.joinById<KitchenRoomState>(first.roomId, { displayName }),
      );
    }

    await waitForState(first, (state) => state.connectedCount === 3);
    const roles = Array.from(first.state.players.values(), (player) => player.role);
    expect(new Set(roles)).toEqual(
      new Set(["BLIND_COOK", "RECIPE_KEEPER", "DEAF_KITCHEN_GUIDE"]),
    );
    expect(first.state.status).toBe("READY");
  });

  test("reconnection preserves the same player identity and role", async () => {
    running = await startKitchenServer({ port: 0, reconnectionGraceSeconds: 2 });
    const client = new Client(running.endpoint);
    const first = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Player One",
    });
    rooms.push(first);
    for (const displayName of ["Player Two", "Player Three"]) {
      rooms.push(
        await client.joinById<KitchenRoomState>(first.roomId, { displayName }),
      );
    }
    await waitForState(first, (state) => state.connectedCount === 3);

    const dropped = rooms[1]!;
    const observer = rooms[0]!;
    const previousSessionId = dropped.sessionId;
    const previousRole = dropped.state.players.get(previousSessionId)!.role;
    const reconnectionToken = dropped.reconnectionToken;
    dropped.reconnection.enabled = false;
    dropped.connection.close();

    await waitForState(observer, (state) => state.connectedCount === 2);
    expect(observer.state.players.get(previousSessionId)?.connected).toBe(false);

    const reconnected = await new Client(running.endpoint).reconnect<KitchenRoomState>(
      reconnectionToken,
    );
    registerPhase3NoopHandlers(reconnected);
    rooms.splice(1, 1, reconnected);
    await waitForState(observer, (state) => state.connectedCount === 3);

    expect(reconnected.sessionId).toBe(previousSessionId);
    expect(reconnected.state.players.get(previousSessionId)?.role).toBe(previousRole);
    expect(reconnected.state.status).toBe("READY");
  });

  test("a dropped seat is reserved during grace and released after timeout", async () => {
    running = await startKitchenServer({ port: 0, reconnectionGraceSeconds: 0.15 });
    const client = new Client(running.endpoint);
    const observer = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Player One",
    });
    rooms.push(observer);
    for (const displayName of ["Player Two", "Player Three"]) {
      rooms.push(
        await client.joinById<KitchenRoomState>(observer.roomId, { displayName }),
      );
    }
    await waitForState(observer, (state) => state.connectedCount === 3);

    const dropped = rooms[2]!;
    const releasedRole = dropped.state.players.get(dropped.sessionId)!.role;
    dropped.reconnection.enabled = false;
    dropped.connection.close();
    await waitForState(observer, (state) => state.connectedCount === 2);

    await expect(
      client.joinById(observer.roomId, { displayName: "Too Early" }),
    ).rejects.toThrow();
    await waitForState(observer, (state) => state.players.size === 2);
    expect(observer.state.status).toBe("WAITING");

    const replacement = await client.joinById<KitchenRoomState>(observer.roomId, {
      displayName: "Replacement",
    });
    registerPhase3NoopHandlers(replacement);
    rooms.splice(2, 1, replacement);
    await waitForState(observer, (state) => state.connectedCount === 3);
    expect(replacement.state.players.get(replacement.sessionId)?.role).toBe(
      releasedRole,
    );
  });

  test("join options cannot claim a role or include unknown fields", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    const rejection = client.create(KITCHEN_ROOM_NAME, {
      displayName: "Cheater",
      role: "BLIND_COOK",
    });

    await expect(rejection).rejects.toBeInstanceOf(MatchMakeError);
    await expect(rejection).rejects.toMatchObject({
      code: ErrorCode.APPLICATION_ERROR,
      message: "Invalid join options",
    });
  });

  test("Blind Cook pickup and drop synchronize authoritative object state", async () => {
    running = await startKitchenServer({ port: 0, placementSeed: "sync-seed" });
    const client = new Client(running.endpoint);
    const blindCook = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Blind Cook",
    });
    rooms.push(blindCook);
    for (const displayName of ["Observer One", "Observer Two"]) {
      rooms.push(
        await client.joinById<KitchenRoomState>(blindCook.roomId, { displayName }),
      );
    }
    const observer = rooms[1]!;
    await waitForState(observer, (state) => state.status === "READY");

    expect(observer.state.placementSeed).toBe("sync-seed");
    const object = Array.from(observer.state.objects.values())[0]!;
    blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });
    await waitForState(
      observer,
      (state) => state.objects.get(object.id)?.heldBy === blindCook.sessionId,
    );

    blindCook.send(KITCHEN_MESSAGES.drop, { objectId: object.id, x: 50, y: 30 });
    await waitForState(observer, (state) => {
      const current = state.objects.get(object.id);
      return current?.heldBy === "" && current.x === 50 && current.y === 30;
    });
  });

  test("Blind Cook pickup while waiting errors only the sender without mutation", async () => {
    running = await startKitchenServer({ port: 0, placementSeed: "waiting-seed" });
    const client = new Client(running.endpoint);
    const blindCook = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Blind Cook",
    });
    rooms.push(blindCook);
    const observer = await client.joinById<KitchenRoomState>(blindCook.roomId, {
      displayName: "Observer",
    });
    rooms.push(observer);
    await waitForState(observer, (state) => state.connectedCount === 2);
    const observerErrors: InteractionErrorPayload[] = [];
    observer.onMessage(KITCHEN_MESSAGES.interactionError, (payload) => {
      observerErrors.push(payload as InteractionErrorPayload);
    });
    const object = Array.from(blindCook.state.objects.values())[0]!;
    const error = nextInteractionError(blindCook);

    blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });

    await expect(error).resolves.toEqual({
      code: "NOT_READY",
      message: "Kitchen is not ready.",
    });
    expect(observer.state.objects.get(object.id)?.heldBy).toBe("");
    expect(observerErrors).toEqual([]);
    expect(observer.state.status).toBe("WAITING");
    expect(blindCook.connection.isOpen).toBe(true);
    expect(observer.connection.isOpen).toBe(true);
  });

  test("non-Blind commands are rejected without mutation and error only the sender", async () => {
    const ready = await createReadyRoom();
    const observerErrors: InteractionErrorPayload[] = [];
    ready.blindCook.onMessage(KITCHEN_MESSAGES.interactionError, (error) => {
      observerErrors.push(error as InteractionErrorPayload);
    });
    const error = nextInteractionError(ready.observer);
    const object = Array.from(ready.observer.state.objects.values())[0]!;

    ready.observer.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });

    await expect(error).resolves.toMatchObject({
      code: "NOT_AUTHORIZED",
      message: "Only the Blind Cook can interact.",
    });
    expect(ready.blindCook.state.objects.get(object.id)?.heldBy).toBe("");
    expect(observerErrors).toEqual([]);
  });

  test("out-of-reach drops are rejected without changing position or ownership", async () => {
    const ready = await createReadyRoom();
    const object = Array.from(ready.blindCook.state.objects.values())[0]!;
    ready.blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });
    await waitForState(
      ready.observer,
      (state) => state.objects.get(object.id)?.heldBy === ready.blindCook.sessionId,
    );
    const before = ready.observer.state.objects.get(object.id)!;
    const previous = { x: before.x, y: before.y };
    const error = nextInteractionError(ready.blindCook);

    ready.blindCook.send(KITCHEN_MESSAGES.drop, { objectId: object.id, x: 0, y: 0 });

    await expect(error).resolves.toMatchObject({ code: "OUT_OF_REACH" });
    const after = ready.observer.state.objects.get(object.id)!;
    expect({ x: after.x, y: after.y, heldBy: after.heldBy }).toEqual({
      ...previous,
      heldBy: ready.blindCook.sessionId,
    });
  });

  test("strict invalid payloads are rejected without mutation or room failure", async () => {
    const ready = await createReadyRoom();
    const object = Array.from(ready.blindCook.state.objects.values())[0]!;
    const error = nextInteractionError(ready.blindCook);

    ready.blindCook.send(KITCHEN_MESSAGES.pickUp, {
      objectId: object.id,
      unexpected: true,
    });

    await expect(error).resolves.toEqual({
      code: "INVALID_COMMAND",
      message: "Invalid pickup command.",
    });
    expect(ready.observer.state.objects.get(object.id)?.heldBy).toBe("");
    expect(ready.observer.state.status).toBe("READY");
  });

  test("a player holding one object cannot acquire a second object", async () => {
    const ready = await createReadyRoom();
    const [first, second] = Array.from(ready.blindCook.state.objects.values());
    ready.blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: first!.id });
    await waitForState(
      ready.observer,
      (state) => state.objects.get(first!.id)?.heldBy === ready.blindCook.sessionId,
    );
    const error = nextInteractionError(ready.blindCook);

    ready.blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: second!.id });

    await expect(error).resolves.toMatchObject({ code: "ALREADY_HOLDING" });
    expect(ready.observer.state.objects.get(second!.id)?.heldBy).toBe("");
  });

  test("transient disconnect and reconnect preserve held-object ownership", async () => {
    const ready = await createReadyRoom(2);
    const object = Array.from(ready.blindCook.state.objects.values())[0]!;
    ready.blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });
    await waitForState(
      ready.observer,
      (state) => state.objects.get(object.id)?.heldBy === ready.blindCook.sessionId,
    );
    const sessionId = ready.blindCook.sessionId;
    const token = ready.blindCook.reconnectionToken;
    ready.blindCook.reconnection.enabled = false;
    ready.blindCook.connection.close();

    await waitForState(ready.observer, (state) => state.connectedCount === 2);
    expect(ready.observer.state.objects.get(object.id)?.heldBy).toBe(sessionId);

    const reconnected = await new Client(running!.endpoint).reconnect<KitchenRoomState>(token);
    registerPhase3NoopHandlers(reconnected);
    rooms.splice(rooms.indexOf(ready.blindCook), 1, reconnected);
    await waitForState(ready.observer, (state) => state.status === "READY");
    expect(ready.observer.state.objects.get(object.id)?.heldBy).toBe(sessionId);
  });

  test("grace expiry releases held objects at their last valid position", async () => {
    const ready = await createReadyRoom(0.15);
    const object = Array.from(ready.blindCook.state.objects.values())[0]!;
    const position = { x: object.x, y: object.y };
    ready.blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });
    await waitForState(
      ready.observer,
      (state) => state.objects.get(object.id)?.heldBy === ready.blindCook.sessionId,
    );
    ready.blindCook.reconnection.enabled = false;
    ready.blindCook.connection.close();

    await waitForState(
      ready.observer,
      (state) => state.players.get(ready.blindCook.sessionId) === undefined,
    );
    const released = ready.observer.state.objects.get(object.id)!;
    expect({ x: released.x, y: released.y, heldBy: released.heldBy }).toEqual({
      ...position,
      heldBy: "",
    });
  });

  test("voluntary leave releases held objects before removing the player", async () => {
    const ready = await createReadyRoom();
    const object = Array.from(ready.blindCook.state.objects.values())[0]!;
    const position = { x: object.x, y: object.y };
    ready.blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });
    await waitForState(
      ready.observer,
      (state) => state.objects.get(object.id)?.heldBy === ready.blindCook.sessionId,
    );

    await ready.blindCook.leave();
    await waitForState(
      ready.observer,
      (state) => state.players.get(ready.blindCook.sessionId) === undefined,
    );
    const released = ready.observer.state.objects.get(object.id)!;
    expect({ x: released.x, y: released.y, heldBy: released.heldBy }).toEqual({
      ...position,
      heldBy: "",
    });
  });

  async function createReadyRoom(reconnectionGraceSeconds?: number): Promise<{
    blindCook: ClientRoom<KitchenRoomState>;
    observer: ClientRoom<KitchenRoomState>;
  }> {
    running = await startKitchenServer({
      port: 0,
      placementSeed: "command-seed",
      ...(reconnectionGraceSeconds ? { reconnectionGraceSeconds } : {}),
    });
    const client = new Client(running.endpoint);
    const blindCook = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Blind Cook",
    });
    rooms.push(blindCook);
    const observer = await client.joinById<KitchenRoomState>(blindCook.roomId, {
      displayName: "Observer",
    });
    rooms.push(observer);
    rooms.push(
      await client.joinById<KitchenRoomState>(blindCook.roomId, {
        displayName: "Third Player",
      }),
    );
    await waitForState(observer, (state) => state.status === "READY");
    return { blindCook, observer };
  }
});

function nextInteractionError(
  room: ClientRoom<KitchenRoomState>,
  timeoutMs = 2_000,
): Promise<InteractionErrorPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for interaction error"));
    }, timeoutMs);
    const unsubscribe = room.onMessage(
      KITCHEN_MESSAGES.interactionError,
      (payload) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(payload as InteractionErrorPayload);
      },
    );
  });
}

function registerPhase3NoopHandlers(room: ClientRoom<KitchenRoomState>): void {
  for (const type of [
    COMMUNICATION_MESSAGES.voiceGrant,
    COMMUNICATION_MESSAGES.boardSnapshot,
    COMMUNICATION_MESSAGES.event,
    COMMUNICATION_MESSAGES.drawingStroke,
    COMMUNICATION_MESSAGES.error,
    COMMUNICATION_MESSAGES.voiceRelay,
  ]) room.onMessage(type, () => undefined);
}

function waitForState(
  room: ClientRoom<KitchenRoomState>,
  predicate: (state: KitchenRoomState) => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  if (predicate(room.state)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.remove();
      reject(new Error("Timed out waiting for room state"));
    }, timeoutMs);
    const subscription = room.onStateChange((state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        subscription.remove();
        resolve();
      }
    });
  });
}
